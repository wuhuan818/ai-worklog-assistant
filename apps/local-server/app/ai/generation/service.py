from __future__ import annotations

import asyncio
import hashlib
import json
import re
import sqlite3
import time
import uuid
from typing import Any, Awaitable, Callable, Optional

from . import repository

PROMPT_VERSION = "ai-summary-prompt/v1"
OUTPUT_SCHEMA_VERSION = "ai-summary-draft/v1"
_SENSITIVE = re.compile(r"(?i)(?:sk-[A-Za-z0-9_-]{10,}|(?:api[_-]?key|token|password|secret)\s*[:=]\s*\S+)")


class GenerationError(Exception):
    def __init__(self, code: str, message: str):
        self.code, self.message = code, message
        super().__init__(message)


def safe_error(value: object) -> str:
    return _SENSITIVE.sub("[REDACTED]", str(value))[:500]


def validate_ready_context(c: sqlite3.Connection, context_id: str) -> dict[str, Any]:
    row = c.execute("SELECT * FROM ai_context_packages WHERE id=?", (context_id,)).fetchone()
    if not row:
        raise GenerationError("context_not_found", "Context package was not found")
    if row["status"] != "ready":
        raise GenerationError("context_not_ready", "Only a Ready Context Package can be generated")
    try:
        context = json.loads(row["context_json"])
    except (TypeError, ValueError):
        raise GenerationError("context_invalid", "Persisted Context Package is invalid")
    if not isinstance(context, dict) or context.get("schema_version") != "task-context-package/v1":
        raise GenerationError("context_schema_unsupported", "Context Package schema is unsupported")
    if not row["content_hash"]:
        raise GenerationError("context_invalid", "Context Package hash is missing")
    if context.get("privacy", {}).get("raw_secret_retained") is not False:
        raise GenerationError("context_privacy_invalid", "Context Package privacy validation failed")
    return {"row": row, "context": context}


def create_job(c: sqlite3.Connection, context_id: str, profile: dict[str, Any], idempotency_key: str, timestamp: str) -> tuple[dict[str, Any], bool]:
    repository.ensure_schema(c)
    ready = validate_ready_context(c, context_id)
    existing = repository.idempotent_job(c, context_id, idempotency_key)
    if existing:
        return existing, False
    active = repository.active_job(c, context_id)
    if active:
        raise GenerationError("generation_already_running", "A generation is already running for this Context Package")
    row = ready["row"]
    job_id = str(uuid.uuid4())
    c.execute("""INSERT INTO ai_generation_jobs(
      id,context_id,task_id,project_id,profile_id,provider,model,prompt_version,
      output_schema_version,context_hash,status,input_estimated_tokens,created_at,idempotency_key)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)""", (
      job_id, context_id, row["task_id"], row["project_id"], profile["profile_id"], profile["provider"], profile["model"],
      PROMPT_VERSION, OUTPUT_SCHEMA_VERSION, row["content_hash"], "queued", int(row["estimated_tokens"]), timestamp, idempotency_key))
    return repository.get_job(c, job_id), True


def cancel_job(c: sqlite3.Connection, job_id: str, timestamp: str) -> dict[str, Any]:
    job = repository.get_job(c, job_id)
    if not job:
        raise GenerationError("generation_not_found", "Generation job was not found")
    if job["status"] in {"succeeded", "failed", "interrupted"}:
        return job
    if job["status"] != "cancelled":
        c.execute("UPDATE ai_generation_jobs SET status='cancelled', cancelled_at=?, finished_at=?, error_code='generation_cancelled', error_summary='Generation was cancelled by user' WHERE id=?", (timestamp, timestamp, job_id))
    return repository.get_job(c, job_id)


def _content_hash(content: Any) -> str:
    return hashlib.sha256(json.dumps(content, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()


def _validated_revision(c: sqlite3.Connection, draft: dict[str, Any], content: Any) -> dict[str, Any]:
    from app.ai.providers.structured import parse_and_validate_summary
    row = c.execute("SELECT context_json FROM ai_context_packages WHERE id=?", (draft["context_id"],)).fetchone()
    if not row: raise GenerationError("context_not_found", "Draft context package was not found")
    try: refs = json.loads(row["context_json"]).get("provenance", {}).get("included_source_refs", [])
    except (TypeError, ValueError): raise GenerationError("context_invalid", "Draft context package is invalid")
    try:
        result, _ = parse_and_validate_summary(json.dumps(content, ensure_ascii=False), refs)
        return result.model_dump()
    except ValueError as error:
        code = "evidence_validation_failed" if getattr(error, "stage", "") == "evidence" else "revision_schema_invalid"
        raise GenerationError(code, "Revision content failed structured validation") from error


def create_revision(c: sqlite3.Connection, task_id: str, draft_id: str, content: Any, source: str, timestamp: str, idempotency_key: Optional[str] = None) -> dict[str, Any]:
    repository.ensure_schema(c); draft = repository.get_draft(c, draft_id)
    if not draft: raise GenerationError("draft_not_found", "Summary draft was not found")
    if draft["task_id"] != task_id: raise GenerationError("draft_task_mismatch", "Summary draft does not belong to this task")
    if idempotency_key:
        existing = c.execute("SELECT * FROM ai_summary_revisions WHERE draft_id=? AND idempotency_key=?", (draft_id, idempotency_key)).fetchone()
        if existing: return repository.revision_output(existing)
    validated = _validated_revision(c, draft, content)
    c.execute("BEGIN IMMEDIATE")
    try:
        next_number = c.execute("SELECT COALESCE(MAX(revision_number),0)+1 FROM ai_summary_revisions WHERE draft_id=?", (draft_id,)).fetchone()[0]
        parent = c.execute("SELECT id FROM ai_summary_revisions WHERE draft_id=? ORDER BY revision_number DESC LIMIT 1", (draft_id,)).fetchone()
        revision_id = str(uuid.uuid4())
        c.execute("INSERT INTO ai_summary_revisions(id,task_id,draft_id,revision_number,parent_revision_id,schema_version,content_json,content_hash,source,idempotency_key,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)", (revision_id, task_id, draft_id, next_number, parent[0] if parent else None, OUTPUT_SCHEMA_VERSION, json.dumps(validated, ensure_ascii=False, sort_keys=True, separators=(",", ":")), _content_hash(validated), source, idempotency_key, timestamp))
        c.commit()
    except Exception: c.rollback(); raise
    return repository.get_revision(c, revision_id)


def approve_revision(c: sqlite3.Connection, task_id: str, draft_id: str, revision_id: str, timestamp: str) -> dict[str, Any]:
    revision = repository.get_revision(c, revision_id)
    if not revision: raise GenerationError("revision_not_found", "Summary revision was not found")
    if revision["task_id"] != task_id or revision["draft_id"] != draft_id: raise GenerationError("revision_task_mismatch", "Revision does not belong to this draft and task")
    c.execute("BEGIN IMMEDIATE")
    try:
        current = repository.current_review(c, task_id)
        if current and current["revision_id"] == revision_id: c.commit(); return current
        if current: c.execute("UPDATE ai_summary_reviews SET superseded_at=?,updated_at=? WHERE id=?", (timestamp, timestamp, current["id"]))
        review_id = str(uuid.uuid4()); c.execute("INSERT INTO ai_summary_reviews(id,task_id,draft_id,revision_id,status,rejection_reason,superseded_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)", (review_id, task_id, draft_id, revision_id, "approved", None, None, timestamp, timestamp)); c.commit()
    except Exception: c.rollback(); raise
    return repository.current_review(c, task_id)


def reject_content(c: sqlite3.Connection, task_id: str, draft_id: str, revision_id: Optional[str], reason: str, timestamp: str) -> dict[str, Any]:
    if not reason.strip(): raise GenerationError("rejection_reason_required", "A rejection reason is required")
    draft = repository.get_draft(c, draft_id)
    if not draft or draft["task_id"] != task_id: raise GenerationError("draft_task_mismatch", "Summary draft does not belong to this task")
    if revision_id:
        revision = repository.get_revision(c, revision_id)
        if not revision or revision["task_id"] != task_id or revision["draft_id"] != draft_id: raise GenerationError("revision_task_mismatch", "Revision does not belong to this draft and task")
    review_id = str(uuid.uuid4()); c.execute("INSERT INTO ai_summary_reviews(id,task_id,draft_id,revision_id,status,rejection_reason,superseded_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)", (review_id, task_id, draft_id, revision_id, "rejected", reason.strip()[:1000], None, timestamp, timestamp)); return [x for x in repository.review_history(c, task_id) if x["id"] == review_id][0]


async def run_job(db_factory: Callable[[], sqlite3.Connection], job_id: str, profile: dict[str, Any], api_key: str, generator: Callable[..., Awaitable[Any]], timestamp: Callable[[], str]) -> None:
    """Run an injected provider adapter; late responses never revive cancelled jobs."""
    c = db_factory(); job = repository.get_job(c, job_id)
    if not job or job["status"] != "queued": return
    c.execute("UPDATE ai_generation_jobs SET status='running', started_at=?, attempt_count=1 WHERE id=? AND status='queued'", (timestamp(), job_id))
    try:
        ready = validate_ready_context(c, job["context_id"])
        started = time.monotonic()
        result = await generator(profile=profile, api_key=api_key, context=ready["context"])
        # Agent A's result may be a pydantic model, dataclass, or dict.
        if isinstance(result, dict):
            content = result.get("content") or result.get("draft")
        else:
            content = getattr(result, "content", None) or getattr(result, "draft", None)
        meta = result if isinstance(result, dict) else getattr(result, "metadata", {}) or {}
        c.execute("UPDATE ai_generation_jobs SET status='validating' WHERE id=? AND status='running'", (job_id,))
        current = repository.get_job(c, job_id)
        if not current or current["status"] == "cancelled": return
        # The repository accepts only the locally schema-validated and redacted
        # representation, including for a test double installed on app.state.
        from app.ai.providers.structured import parse_and_validate_summary
        source_refs = ready["context"].get("provenance", {}).get("included_source_refs", [])
        try:
            serialized = content if isinstance(content, str) else json.dumps(content, ensure_ascii=False)
            validated, redaction_count = parse_and_validate_summary(serialized, source_refs)
            content = validated.model_dump()
        except ValueError as error:
            code = "evidence_validation_failed" if str(error) == "invalid_evidence_refs" else "structured_output_invalid"
            raise GenerationError(code, "Provider output failed local structured validation") from error
        if isinstance(meta, dict):
            meta = {**meta, "output_redaction_count": max(int(meta.get("output_redaction_count", 0)), redaction_count), "latency_ms": meta.get("latency_ms") or round((time.monotonic() - started) * 1000)}
        draft_id = str(uuid.uuid4()); created = timestamp()
        c.execute("""INSERT INTO ai_summary_drafts(id,generation_job_id,context_id,task_id,project_id,schema_version,status,content_json,content_hash,provider,model,prompt_version,context_hash,output_redaction_count,created_at,updated_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""", (draft_id, job_id, current["context_id"], current["task_id"], current["project_id"], OUTPUT_SCHEMA_VERSION, "draft", json.dumps(content, ensure_ascii=False, sort_keys=True, separators=(",", ":")), _content_hash(content), current["provider"], current["model"], PROMPT_VERSION, current["context_hash"], int(meta.get("output_redaction_count", 0)), created, created))
        c.execute("UPDATE ai_generation_jobs SET status='succeeded', finished_at=?, latency_ms=?, provider_prompt_tokens=?, provider_completion_tokens=?, provider_total_tokens=?, attempt_count=? WHERE id=? AND status='validating'", (created, meta.get("latency_ms"), meta.get("prompt_tokens"), meta.get("completion_tokens"), meta.get("total_tokens"), int(meta.get("attempt_count", 1)), job_id))
    except asyncio.CancelledError:
        raise
    except Exception as error:
        current = repository.get_job(c, job_id)
        if current and current["status"] != "cancelled":
            code = getattr(error, "code", "provider_invalid_response")
            summary = getattr(error, "summary", None) or getattr(error, "message", error)
            c.execute("UPDATE ai_generation_jobs SET status='failed', error_code=?, error_summary=?, finished_at=? WHERE id=? AND status IN ('queued','running','validating')", (code, safe_error(summary), timestamp(), job_id))
