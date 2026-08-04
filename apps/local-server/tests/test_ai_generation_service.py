from __future__ import annotations

import asyncio
import os
import sys

import pytest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
import app.main as main
from app.ai.generation import repository, service


def ready_context(c, context_id="context-1", task_id="task-1"):
    c.execute("INSERT OR IGNORE INTO projects(id,user_id,name,slug) VALUES ('project-1','local-user','Project','project')")
    c.execute("INSERT OR IGNORE INTO tasks(id,user_id,project_id,name,status) VALUES (?, 'local-user','project-1','Task','completed')", (task_id,))
    content = {"schema_version":"task-context-package/v1", "privacy":{"raw_secret_retained":False}, "provenance":{"included_source_refs":[]}}
    c.execute("INSERT INTO ai_context_packages(id,schema_version,project_id,task_id,status,build_config_json,context_json,content_hash,estimated_tokens,redaction_count,truncation_count,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)", (context_id,"task-context-package/v1","project-1",task_id,"ready","{}",__import__('json').dumps(content),"context-hash",12,0,0,"now","now"))


@pytest.fixture()
def database(tmp_path):
    main.DB_PATH = tmp_path / "generation.db"
    c = main.db(); ready_context(c); c.commit()
    return c


def profile():
    return {"profile_id":"profile","provider":"deepseek","base_url":"http://localhost","model":"model"}


def valid_content():
    return {"schema_version":"ai-summary-draft/v1", "sections": {
        "task_summary": {"summary":"done", "outcomes":[], "evidence_refs":[]},
        "code_changes": [], "commands_and_results": [], "bug_solutions": [],
        "unresolved_issues": [], "todos": [],
        "daily_report": {"title":"report", "body":"done", "highlights":[], "blockers":[], "next_focus":[], "evidence_refs":[]},
        "knowledge_candidates": []}}


def test_job_idempotency_and_single_active_job(database):
    first, created = service.create_job(database, "context-1", profile(), "same", "now")
    assert created and first["status"] == "queued"
    again, created = service.create_job(database, "context-1", profile(), "same", "now")
    assert not created and again["id"] == first["id"]
    with pytest.raises(service.GenerationError) as error:
        service.create_job(database, "context-1", profile(), "other", "now")
    assert error.value.code == "generation_already_running"


def test_cancelled_job_never_creates_draft(database):
    job, _ = service.create_job(database, "context-1", profile(), "cancel", "now")
    service.cancel_job(database, job["id"], "later")
    async def generator(**kwargs): return {"content": valid_content()}
    asyncio.run(service.run_job(lambda: database, job["id"], profile(), "synthetic-secret", generator, lambda: "later"))
    assert repository.get_job(database, job["id"])["status"] == "cancelled"
    assert repository.list_drafts(database, "task-1") == []


def test_successful_job_creates_immutable_new_draft(database):
    job, _ = service.create_job(database, "context-1", profile(), "first", "now")
    async def generator(**kwargs):
        return {"content": valid_content(), "latency_ms": 4}
    asyncio.run(service.run_job(lambda: database, job["id"], profile(), "synthetic-secret", generator, lambda: "later"))
    assert repository.get_job(database, job["id"])["status"] == "succeeded"
    drafts = repository.list_drafts(database, "task-1")
    assert len(drafts) == 1 and drafts[0]["generation_job_id"] == job["id"]


def test_restart_marks_active_jobs_interrupted(database):
    job, _ = service.create_job(database, "context-1", profile(), "restart", "now")
    assert repository.interrupt_active(database, "restart") == 1
    updated = repository.get_job(database, job["id"])
    assert updated["status"] == "interrupted" and updated["error_code"] == "generation_interrupted"


def test_ready_context_gate_rejects_not_ready(database):
    database.execute("UPDATE ai_context_packages SET status='preview' WHERE id='context-1'")
    with pytest.raises(service.GenerationError) as error:
        service.create_job(database, "context-1", profile(), "bad", "now")
    assert error.value.code == "context_not_ready"
