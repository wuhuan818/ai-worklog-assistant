from __future__ import annotations

import json
import sqlite3
from typing import Optional

from . import repository
from .builder import build
from .models import ContextBuildConfig
from .provenance import content_hash

class ContextError(Exception):
    def __init__(self, code: str, message: str): self.code, self.message = code, message

def _task(c, task_id):
    row = c.execute("SELECT * FROM tasks WHERE id=? AND user_id=?", (task_id, "local-user")).fetchone()
    if not row: raise ContextError("task_not_found", "Task was not found")
    if row["status"] != "completed": raise ContextError("task_not_completed", "Context packages require a completed task")
    return row

def build_package(c: sqlite3.Connection, task_id: str, config: ContextBuildConfig, idempotency_key: Optional[str], timestamp: str) -> dict:
    repository.ensure_schema(c); _task(c, task_id)
    existing = repository.idempotent(c, task_id, idempotency_key)
    if existing:
        old = json.loads(existing["build_config_json"])
        current = config.model_dump() if hasattr(config, "model_dump") else config.dict()
        if old != current: raise ContextError("idempotency_conflict", "Idempotency key was previously used with a different configuration")
        return repository.row_output(existing)
    try:
        package = build(c, task_id, config)
    except Exception as error:
        # The budgeting module uses this typed local exception; do not expose a
        # traceback or partially persisted snapshot over the HTTP boundary.
        if getattr(error, "code", None) == "minimum_context_exceeds_budget":
            raise ContextError("minimum_context_exceeds_budget", "The minimum context exceeds the configured token budget")
        raise
    budget = package["budget"]
    if budget["estimated_tokens_after"] > config.estimated_input_token_budget:
        raise ContextError("minimum_context_exceeds_budget", "The context exceeds the configured token budget")
    package["created_at"] = timestamp; package["updated_at"] = timestamp
    package["content_hash"] = content_hash(package); package["provenance"]["content_hash"] = package["content_hash"]
    c.execute("INSERT INTO ai_context_packages(id,schema_version,project_id,task_id,status,build_config_json,context_json,content_hash,estimated_tokens,redaction_count,truncation_count,created_at,updated_at,idempotency_key) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      (package["context_id"], package["schema_version"], package["project"]["project_id"], task_id, "preview", json.dumps(config.model_dump() if hasattr(config, "model_dump") else config.dict(), sort_keys=True, separators=(",",":")), json.dumps(package, ensure_ascii=False, sort_keys=True, separators=(",",":")), package["content_hash"], budget["estimated_tokens_after"], package["privacy"].get("redaction_count",0), 0, timestamp, timestamp, idempotency_key))
    return repository.get(c, package["context_id"])

def ready_package(c: sqlite3.Connection, context_id: str, timestamp: str) -> dict:
    repository.ensure_schema(c)
    row = c.execute("SELECT * FROM ai_context_packages WHERE id=?", (context_id,)).fetchone()
    if not row: raise ContextError("context_not_found", "Context package was not found")
    if row["status"] == "ready": return repository.row_output(row)
    if row["status"] != "preview": raise ContextError("context_invalid", "Context package cannot be marked ready")
    response = repository.row_output(row); package = response.get("context")
    _task(c, row["task_id"])
    if not isinstance(package, dict) or not package or package.get("schema_version") != "task-context-package/v1" or not response.get("content_hash"):
        raise ContextError("context_invalid", "Context package schema or hash is invalid")
    required = ("task", "privacy", "budget", "provenance")
    if any(not isinstance(package.get(key), dict) or not package.get(key) for key in required):
        raise ContextError("context_invalid", "Context package is incomplete")
    if package.get("privacy",{}).get("raw_secret_retained") is not False:
        raise ContextError("privacy_validation_failed", "Context package failed privacy validation")
    budget=package["budget"]
    tokens, limit = budget.get("estimated_tokens_after"), budget.get("estimated_token_budget")
    if isinstance(tokens, bool) or isinstance(limit, bool) or not isinstance(tokens, int) or not isinstance(limit, int) or tokens < 0 or limit < 1 or tokens > limit:
        raise ContextError("budget_validation_failed", "Context package exceeds its token budget")
    c.execute("UPDATE ai_context_packages SET status='superseded',superseded_at=?,updated_at=? WHERE task_id=? AND status='ready'", (timestamp,timestamp,row["task_id"]))
    c.execute("UPDATE ai_context_packages SET status='ready',ready_at=?,updated_at=? WHERE id=?", (timestamp,timestamp,context_id))
    return repository.get(c, context_id)
