from __future__ import annotations

import json
import os
import sqlite3
import sys

from fastapi.testclient import TestClient
import pytest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import app.main as main
from app.ai.providers.structured import parse_and_validate_summary
from app.main import app


PATCH = """--- a/src/hello.cpp
+++ b/src/hello.cpp
@@ -1,1 +1,1 @@
-std::cout << greet(userName) << std::endl;
+std::cout << greet(\"World\") << std::endl;"""


@pytest.fixture()
def client(tmp_path):
    main.DB_PATH = tmp_path / "code-change.db"
    main.TOKEN = "code-change-token"
    return TestClient(app)


@pytest.fixture()
def headers():
    return {"Authorization": "Bearer code-change-token"}


def active_task(client, headers):
    return client.post("/tasks", headers=headers, json={"name": "Capture C++ diff", "project": "Capture Project"}).json()


def code_diff_payload(event_id="cpp-diff", patch=PATCH, **overrides):
    payload = {
        "client_event_id": event_id,
        "event_type": "code_diff",
        "source": "vscode",
        "workspace_path": "C:/workspace",
        "file_path": "src/hello.cpp",
        "occurred_at": "2026-08-09T00:00:00Z",
        "payload": {
            "language_id": "cpp",
            "patch": patch,
            "added_lines": 1,
            "removed_lines": 1,
            "changed_ranges": [{"before_start_line": 1, "before_line_count": 1, "after_start_line": 1, "after_line_count": 1}],
            "original_patch_bytes": len(patch.encode("utf-8")),
            "retained_patch_bytes": len(patch.encode("utf-8")),
            "patch_truncated": False,
            "capture_mode": "save-time-snapshot",
        },
    }
    payload.update(overrides)
    return payload


def valid_summary(ref):
    return {
        "schema_version": "ai-summary-draft/v1",
        "sections": {
            "task_summary": {"summary": "Updated greeting", "outcomes": [], "evidence_refs": [ref]},
            "code_changes": [{"path": "src/hello.cpp", "summary": "Replaced userName with World", "impact": "fixes the call", "evidence_refs": [ref]}],
            "commands_and_results": [], "bug_solutions": [], "unresolved_issues": [], "todos": [],
            "daily_report": {"title": "Capture", "body": "Captured a diff", "highlights": [], "blockers": [], "next_focus": [], "evidence_refs": [ref]},
            "knowledge_candidates": [],
        },
    }


def test_cpp_save_diff_reaches_context_evidence_and_survives_reopen(client, headers):
    task = active_task(client, headers)
    stored = client.post(f"/tasks/{task['id']}/events/batch", headers=headers, json={"events": [code_diff_payload()]})
    assert stored.status_code == 200
    event_id = stored.json()["event_ids"][0]

    # A fresh connection is the observable restart-recovery boundary for SQLite.
    reopened = sqlite3.connect(main.DB_PATH)
    assert reopened.execute("SELECT payload_json FROM worklog_events WHERE id=?", (event_id,)).fetchone() is not None
    reopened.close()

    assert client.post(f"/tasks/{task['id']}/end", headers=headers).status_code == 200
    context_response = client.post(f"/tasks/{task['id']}/ai/context-packages", headers=headers, json={"config": {"estimated_input_token_budget": 32000}})
    assert context_response.status_code == 200
    context = context_response.json()["context"]
    assert len(context["code_diffs"]) == 1
    assert context["code_diffs"][0]["path"] == "src/hello.cpp"
    assert context["code_diffs"][0]["patch"] == PATCH
    assert context["code_diffs"][0]["changed_ranges"][0]["before_start_line"] == 1
    reference = f"code_diff:{event_id}"
    assert {"type": "code_diff", "id": event_id} in context["provenance"]["included_source_refs"]
    summary, _ = parse_and_validate_summary(json.dumps(valid_summary(reference)), context["provenance"]["included_source_refs"])
    assert summary.sections.code_changes[0].evidence_refs == [reference]


def test_code_diff_rejects_extension_camel_case_path_keys(client, headers):
    """The buffered capture wire contract is snake_case, unlike response DTOs."""
    task = active_task(client, headers)
    event = code_diff_payload("camel-case-path")
    event["workspacePath"] = event.pop("workspace_path")
    event["filePath"] = event.pop("file_path")

    response = client.post(f"/tasks/{task['id']}/events/batch", headers=headers, json={"events": [event]})

    assert response.status_code == 422
    assert "code_diff file_path is required" in response.text


def test_code_diff_is_redacted_before_persistence_and_bounded_by_dto(client, headers):
    task = active_task(client, headers)
    secret_patch = PATCH + "\n+api_key=not-for-storage-123456"
    response = client.post(f"/tasks/{task['id']}/events/batch", headers=headers, json={"events": [code_diff_payload("secret-diff", secret_patch)]})
    assert response.status_code == 200
    event_id = response.json()["event_ids"][0]
    persisted = main.db().execute("SELECT payload_json FROM worklog_events WHERE id=?", (event_id,)).fetchone()["payload_json"]
    assert "not-for-storage-123456" not in persisted
    assert "<redacted:api-key>" in persisted

    oversized = code_diff_payload("too-large", "x" * 245001)
    oversized["payload"].update({"original_patch_bytes": 245001, "retained_patch_bytes": 245001})
    rejected = client.post(f"/tasks/{task['id']}/events/batch", headers=headers, json={"events": [oversized]})
    assert rejected.status_code == 422
    legacy = client.post("/events", headers=headers, json={"projectId": task["project_id"], "taskId": task["id"], "type": "code_diff", "timestamp": "2026-08-09T00:00:00Z", "payload": {"patch": "unbounded"}})
    assert legacy.status_code == 422


def test_context_reports_capture_time_diff_truncation(client, headers):
    task = active_task(client, headers)
    payload = code_diff_payload("truncated", PATCH)
    payload["payload"].update({"patch_truncated": True, "original_patch_bytes": 9999, "retained_patch_bytes": len(PATCH.encode("utf-8"))})
    assert client.post(f"/tasks/{task['id']}/events/batch", headers=headers, json={"events": [payload]}).status_code == 200
    assert client.post(f"/tasks/{task['id']}/end", headers=headers).status_code == 200
    response = client.post(f"/tasks/{task['id']}/ai/context-packages", headers=headers, json={"config": {"estimated_input_token_budget": 32000}})
    assert response.status_code == 200
    assert response.json()["truncation_count"] >= 1


def test_context_excludes_code_diff_and_its_evidence_when_disabled(client, headers):
    task = active_task(client, headers)
    stored = client.post(f"/tasks/{task['id']}/events/batch", headers=headers, json={"events": [code_diff_payload("disabled")]})
    assert stored.status_code == 200
    event_id = stored.json()["event_ids"][0]
    assert client.post(f"/tasks/{task['id']}/end", headers=headers).status_code == 200
    response = client.post(f"/tasks/{task['id']}/ai/context-packages", headers=headers, json={"config": {"estimated_input_token_budget": 32000, "include_diff_snippets": False}})
    assert response.status_code == 200
    context = response.json()["context"]
    assert context["code_diffs"] == []
    assert {"type": "code_diff", "id": event_id} not in context["provenance"]["included_source_refs"]
