from __future__ import annotations

import json
import sqlite3
from typing import Any, Optional

def ensure_schema(c: sqlite3.Connection) -> None:
    c.executescript("""
      CREATE TABLE IF NOT EXISTS ai_context_packages(
        id TEXT PRIMARY KEY, schema_version TEXT NOT NULL, project_id TEXT NOT NULL,
        task_id TEXT NOT NULL, status TEXT NOT NULL, build_config_json TEXT NOT NULL,
        context_json TEXT NOT NULL, content_hash TEXT NOT NULL, estimated_tokens INTEGER NOT NULL,
        redaction_count INTEGER NOT NULL DEFAULT 0, truncation_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, ready_at TEXT, superseded_at TEXT,
        idempotency_key TEXT
      );
      CREATE UNIQUE INDEX IF NOT EXISTS ux_ai_context_packages_idempotency
        ON ai_context_packages(task_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
      CREATE INDEX IF NOT EXISTS ix_ai_context_packages_task_created
        ON ai_context_packages(task_id, created_at DESC, id DESC);
      CREATE UNIQUE INDEX IF NOT EXISTS ux_ai_context_packages_one_ready
        ON ai_context_packages(task_id) WHERE status='ready';
    """)

def row_output(row: sqlite3.Row) -> dict:
    package = json.loads(row["context_json"])
    package.update({"context_id": row["id"], "status": row["status"], "created_at": row["created_at"],
                    "updated_at": row["updated_at"], "ready_at": row["ready_at"], "content_hash": row["content_hash"]})
    return package

def get(c: sqlite3.Connection, context_id: str) -> Optional[dict]:
    row = c.execute("SELECT * FROM ai_context_packages WHERE id=?", (context_id,)).fetchone()
    return row_output(row) if row else None

def list_for_task(c: sqlite3.Connection, task_id: str) -> list[dict]:
    return [row_output(row) for row in c.execute("SELECT * FROM ai_context_packages WHERE task_id=? ORDER BY created_at DESC,id DESC", (task_id,))]

def idempotent(c: sqlite3.Connection, task_id: str, key: Optional[str]) -> Optional[sqlite3.Row]:
    if not key: return None
    return c.execute("SELECT * FROM ai_context_packages WHERE task_id=? AND idempotency_key=?", (task_id, key)).fetchone()
