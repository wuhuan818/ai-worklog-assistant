from __future__ import annotations

import json
import sqlite3
from typing import Any, Optional


ACTIVE_STATUSES = ("queued", "running", "validating")


def ensure_schema(c: sqlite3.Connection) -> None:
    """Additive Stage 9/10A migration; no request secrets or responses are stored."""
    c.executescript("""
      CREATE TABLE IF NOT EXISTS ai_generation_jobs(
        id TEXT PRIMARY KEY, context_id TEXT NOT NULL, task_id TEXT NOT NULL,
        project_id TEXT NOT NULL, profile_id TEXT NOT NULL, provider TEXT NOT NULL,
        model TEXT NOT NULL, prompt_version TEXT NOT NULL,
        output_schema_version TEXT NOT NULL, context_hash TEXT NOT NULL,
        status TEXT NOT NULL, attempt_count INTEGER NOT NULL DEFAULT 0,
        error_code TEXT, error_summary TEXT, input_estimated_tokens INTEGER NOT NULL,
        provider_prompt_tokens INTEGER, provider_completion_tokens INTEGER,
        provider_total_tokens INTEGER, latency_ms INTEGER, created_at TEXT NOT NULL,
        started_at TEXT, finished_at TEXT, cancelled_at TEXT,
        idempotency_key TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS ux_ai_generation_jobs_idempotency
        ON ai_generation_jobs(context_id, idempotency_key);
      CREATE INDEX IF NOT EXISTS ix_ai_generation_jobs_context_status
        ON ai_generation_jobs(context_id, status, created_at DESC);
      CREATE INDEX IF NOT EXISTS ix_ai_generation_jobs_task_created
        ON ai_generation_jobs(task_id, created_at DESC);
      CREATE TABLE IF NOT EXISTS ai_summary_drafts(
        id TEXT PRIMARY KEY, generation_job_id TEXT NOT NULL UNIQUE,
        context_id TEXT NOT NULL, task_id TEXT NOT NULL, project_id TEXT NOT NULL,
        schema_version TEXT NOT NULL, status TEXT NOT NULL, content_json TEXT NOT NULL,
        content_hash TEXT NOT NULL, provider TEXT NOT NULL, model TEXT NOT NULL,
        prompt_version TEXT NOT NULL, context_hash TEXT NOT NULL,
        output_redaction_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS ix_ai_summary_drafts_task_created
        ON ai_summary_drafts(task_id, created_at DESC, id DESC);
      CREATE TABLE IF NOT EXISTS ai_summary_revisions(
        id TEXT PRIMARY KEY, task_id TEXT NOT NULL, draft_id TEXT NOT NULL,
        revision_number INTEGER NOT NULL, parent_revision_id TEXT,
        schema_version TEXT NOT NULL, content_json TEXT NOT NULL, content_hash TEXT NOT NULL,
        source TEXT NOT NULL, idempotency_key TEXT, created_at TEXT NOT NULL,
        UNIQUE(draft_id, revision_number), UNIQUE(draft_id, idempotency_key)
      );
      CREATE INDEX IF NOT EXISTS ix_ai_summary_revisions_draft_created
        ON ai_summary_revisions(draft_id, revision_number DESC, id DESC);
      CREATE TABLE IF NOT EXISTS ai_summary_reviews(
        id TEXT PRIMARY KEY, task_id TEXT NOT NULL, draft_id TEXT NOT NULL,
        revision_id TEXT, status TEXT NOT NULL CHECK(status IN ('pending','approved','rejected')),
        rejection_reason TEXT, superseded_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS ix_ai_summary_reviews_task_created
        ON ai_summary_reviews(task_id, created_at DESC, id DESC);
      CREATE UNIQUE INDEX IF NOT EXISTS ux_ai_summary_reviews_current_approved
        ON ai_summary_reviews(task_id) WHERE status='approved' AND superseded_at IS NULL;
    """)


def _job(row: sqlite3.Row) -> dict[str, Any]:
    return dict(row)


def get_job(c: sqlite3.Connection, job_id: str) -> Optional[dict[str, Any]]:
    row = c.execute("SELECT * FROM ai_generation_jobs WHERE id=?", (job_id,)).fetchone()
    return _job(row) if row else None


def idempotent_job(c: sqlite3.Connection, context_id: str, key: str) -> Optional[dict[str, Any]]:
    row = c.execute("SELECT * FROM ai_generation_jobs WHERE context_id=? AND idempotency_key=?", (context_id, key)).fetchone()
    return _job(row) if row else None


def active_job(c: sqlite3.Connection, context_id: str) -> Optional[dict[str, Any]]:
    row = c.execute("SELECT * FROM ai_generation_jobs WHERE context_id=? AND status IN ('queued','running','validating') ORDER BY created_at DESC LIMIT 1", (context_id,)).fetchone()
    return _job(row) if row else None


def draft_output(row: sqlite3.Row) -> dict[str, Any]:
    out = dict(row)
    out["content"] = json.loads(out.pop("content_json"))
    return out


def get_draft(c: sqlite3.Connection, draft_id: str) -> Optional[dict[str, Any]]:
    row = c.execute("SELECT * FROM ai_summary_drafts WHERE id=?", (draft_id,)).fetchone()
    return draft_output(row) if row else None


def list_drafts(c: sqlite3.Connection, task_id: str) -> list[dict[str, Any]]:
    rows = c.execute("SELECT * FROM ai_summary_drafts WHERE task_id=? AND status='draft' ORDER BY created_at DESC, id DESC", (task_id,)).fetchall()
    return [draft_output(row) for row in rows]


def list_revisions(c: sqlite3.Connection, draft_id: str) -> list[dict[str, Any]]:
    rows = c.execute("SELECT * FROM ai_summary_revisions WHERE draft_id=? ORDER BY revision_number DESC, id DESC", (draft_id,)).fetchall()
    return [revision_output(row) for row in rows]


def revision_output(row: sqlite3.Row) -> dict[str, Any]:
    out = dict(row); out["content"] = json.loads(out.pop("content_json")); return out


def get_revision(c: sqlite3.Connection, revision_id: str) -> Optional[dict[str, Any]]:
    row = c.execute("SELECT * FROM ai_summary_revisions WHERE id=?", (revision_id,)).fetchone()
    return revision_output(row) if row else None


def review_history(c: sqlite3.Connection, task_id: str) -> list[dict[str, Any]]:
    return [dict(row) for row in c.execute("SELECT * FROM ai_summary_reviews WHERE task_id=? ORDER BY created_at DESC, id DESC", (task_id,)).fetchall()]


def current_review(c: sqlite3.Connection, task_id: str) -> Optional[dict[str, Any]]:
    row = c.execute("SELECT * FROM ai_summary_reviews WHERE task_id=? AND status='approved' AND superseded_at IS NULL", (task_id,)).fetchone()
    return dict(row) if row else None


def interrupt_active(c: sqlite3.Connection, timestamp: str) -> int:
    result = c.execute("UPDATE ai_generation_jobs SET status='interrupted', error_code='generation_interrupted', error_summary='Generation was interrupted by backend restart', finished_at=? WHERE status IN ('queued','running','validating')", (timestamp,))
    return result.rowcount
