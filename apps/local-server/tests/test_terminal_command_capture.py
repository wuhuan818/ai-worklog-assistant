from __future__ import annotations

import copy
from concurrent.futures import ThreadPoolExecutor
import json
import os
import sqlite3
import sys
import threading
import time

from fastapi.testclient import TestClient
import pytest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import app.main as main
from app.ai.providers.structured import parse_and_validate_summary
from app.main import app


@pytest.fixture()
def client(tmp_path):
    main.DB_PATH = tmp_path / "terminal-command.db"
    main.TOKEN = "terminal-command-token"
    return TestClient(app)


@pytest.fixture()
def headers():
    return {"Authorization": "Bearer terminal-command-token"}


def active_task(client, headers):
    return client.post("/tasks", headers=headers, json={"name": "Capture terminal commands", "project": "Terminal Project"}).json()


def terminal_event(event_id="terminal-1", command="npm.cmd test", **payload_overrides):
    command_bytes = len(command.encode("utf-8"))
    payload = {
        "command": command,
        "confidence": "high",
        "status": "succeeded",
        "exit_code": 0,
        "started_at": "2026-08-09T01:02:03.456Z",
        "duration_ms": 321,
        "original_command_bytes": command_bytes,
        "retained_command_bytes": command_bytes,
        "command_truncated": False,
        "capture_mode": "shell-integration",
        "is_trusted": True,
        "output_captured": False,
        "cwd": "apps/local-server",
    }
    payload.update(payload_overrides)
    return {
        "client_event_id": event_id,
        "event_type": "terminal_command",
        "source": "vscode",
        "workspace_path": "C:/workspace",
        "occurred_at": "2026-08-09T01:02:04Z",
        "payload": payload,
    }


def valid_summary(reference, command="npm.cmd test"):
    return {
        "schema_version": "ai-summary-draft/v1",
        "sections": {
            "task_summary": {"summary": "Ran the project tests", "outcomes": ["Tests passed"], "evidence_refs": [reference]},
            "code_changes": [],
            "commands_and_results": [{"command": command, "result": "Exited with code 0", "status": "succeeded", "evidence_refs": [reference]}],
            "bug_solutions": [], "unresolved_issues": [], "todos": [],
            "daily_report": {"title": "Terminal capture", "body": "Ran the test command", "highlights": [], "blockers": [], "next_focus": [], "evidence_refs": [reference]},
            "knowledge_candidates": [],
        },
    }


def test_terminal_command_survives_reopen_and_reaches_context_and_structured_summary(client, headers):
    task = active_task(client, headers)
    event = terminal_event(f"terminal-{task['id']}")
    stored = client.post(f"/tasks/{task['id']}/events/batch", headers=headers, json={"events": [event]})
    assert stored.status_code == 200
    event_id = stored.json()["event_ids"][0]

    reopened = sqlite3.connect(main.DB_PATH)
    row = reopened.execute("SELECT event_type,payload_json FROM worklog_events WHERE id=?", (event_id,)).fetchone()
    reopened.close()
    assert row is not None and row[0] == "terminal_command"
    assert json.loads(row[1])["command"] == "npm.cmd test"

    assert client.post(f"/tasks/{task['id']}/end", headers=headers).status_code == 200
    response = client.post(f"/tasks/{task['id']}/ai/context-packages", headers=headers, json={"config": {"estimated_input_token_budget": 32000}})
    assert response.status_code == 200
    context = response.json()["context"]
    commands = [item for item in context["commands_and_tasks"] if item.get("event_type") == "terminal_command"]
    assert len(commands) == 1
    assert commands[0]["command"] == "npm.cmd test"
    assert commands[0]["cwd"] == "apps/local-server"
    assert commands[0]["output_captured"] is False
    assert context["statistics"]["terminal_commands"] == 1
    reference = f"terminal_command:{event_id}"
    assert {"type": "terminal_command", "id": event_id} in context["provenance"]["included_source_refs"]

    summary, count = parse_and_validate_summary(json.dumps(valid_summary(reference)), context["provenance"]["included_source_refs"])
    assert count == 0
    assert summary.sections.commands_and_results[0].command == "npm.cmd test"
    assert summary.sections.commands_and_results[0].evidence_refs == [reference]


def test_terminal_secret_is_redacted_before_sqlite_and_counted_in_context(client, headers):
    task = active_task(client, headers)
    secret = "super-secret-token-123456"
    command = f'curl -H "Authorization: Bearer {secret}" https://example.test'
    event = terminal_event(
        f"terminal-secret-{task['id']}",
        command,
    )
    stored = client.post(f"/tasks/{task['id']}/events/batch", headers=headers, json={"events": [event]})
    assert stored.status_code == 200
    event_id = stored.json()["event_ids"][0]
    persisted_json = main.db().execute("SELECT payload_json FROM worklog_events WHERE id=?", (event_id,)).fetchone()["payload_json"]
    persisted = json.loads(persisted_json)
    assert secret not in persisted_json
    assert "<redacted:bearer-token>" in persisted["command"]
    assert persisted["redaction_count"] == 1
    assert persisted["redaction_categories"] == {"bearer-token": 1}
    assert persisted["retained_command_bytes"] == len(persisted["command"].encode("utf-8"))
    assert persisted["original_command_bytes"] == persisted["retained_command_bytes"]

    assert client.post(f"/tasks/{task['id']}/end", headers=headers).status_code == 200
    response = client.post(f"/tasks/{task['id']}/ai/context-packages", headers=headers, json={"config": {"estimated_input_token_budget": 32000}})
    context = response.json()["context"]
    assert secret not in json.dumps(context, ensure_ascii=False)
    assert context["privacy"]["persisted_redaction_count"] == 1
    assert context["privacy"]["redaction_count"] >= 1
    assert context["privacy"]["redaction_categories"]["bearer-token"] >= 1
    assert context["privacy"]["raw_secret_retained"] is False


@pytest.mark.parametrize("command", [
    "cmd /c curl -u alice:sqlitewrappersecret https://example.test",
    'pwsh -c "curl -u alice:sqlitewrappersecret https://example.test"',
    '& "curl.exe" -u alice:sqlitewrappersecret https://example.test',
    "env curl -u alice:sqlitewrappersecret https://example.test",
    "env FOO=x curl -u alice:sqlitewrappersecret https://example.test",
    "sudo -u root curl -u alice:sqlitewrappersecret https://example.test",
    "time -p curl -u alice:sqlitewrappersecret https://example.test",
    "nice curl -u alice:sqlitewrappersecret https://example.test",
    "command -- curl -u alice:sqlitewrappersecret https://example.test",
])
def test_wrapped_curl_credentials_are_redacted_before_sqlite(client, headers, command):
    task = active_task(client, headers)
    event = terminal_event(f"terminal-wrapper-{task['id']}", command)
    stored = client.post(f"/tasks/{task['id']}/events/batch", headers=headers, json={"events": [event]})
    assert stored.status_code == 200
    event_id = stored.json()["event_ids"][0]
    payload_json = main.db().execute("SELECT payload_json FROM worklog_events WHERE id=?", (event_id,)).fetchone()["payload_json"]
    assert "sqlitewrappersecret" not in payload_json
    assert "<redacted:credential>" in payload_json


def test_redaction_expansion_is_rebounded_before_terminal_persistence(client, headers):
    task = active_task(client, headers)
    command = ("A_TOKEN=x " * 700).strip()
    event = terminal_event(f"terminal-expanded-{task['id']}", command)
    stored = client.post(f"/tasks/{task['id']}/events/batch", headers=headers, json={"events": [event]})
    assert stored.status_code == 200
    event_id = stored.json()["event_ids"][0]
    payload = json.loads(main.db().execute("SELECT payload_json FROM worklog_events WHERE id=?", (event_id,)).fetchone()["payload_json"])
    assert len(payload["command"].encode("utf-8")) <= 8192
    assert payload["retained_command_bytes"] == len(payload["command"].encode("utf-8"))
    assert payload["original_command_bytes"] > payload["retained_command_bytes"]
    assert payload["command_truncated"] is True
    assert payload["command"].endswith("<command-truncated>")
    assert "<red " not in payload["command"]

    assert client.post(f"/tasks/{task['id']}/end", headers=headers).status_code == 200
    response = client.post(f"/tasks/{task['id']}/ai/context-packages", headers=headers, json={"config": {"estimated_input_token_budget": 32000}})
    contextualized = next(item for item in response.json()["context"]["commands_and_tasks"] if item["id"] == event_id)
    assert contextualized["command"] == payload["command"]
    assert contextualized["retained_command_bytes"] == len(contextualized["command"].encode("utf-8"))


def test_terminal_command_rejects_oversized_and_malformed_payloads(client, headers):
    task = active_task(client, headers)
    base = terminal_event("invalid-base")["payload"]
    oversized = "x" * 8193
    invalid_payloads = [
        dict(base, command=oversized, original_command_bytes=8193, retained_command_bytes=8193),
        dict(base, command="npm.cmd test\nwhoami"),
        dict(base, command="echo \u009b31m"),
        dict(base, command="echo\ud800", original_command_bytes=7, retained_command_bytes=7),
        dict(base, command=" npm.cmd test"),
        dict(base, command="e\u0301cho test"),
        dict(base, confidence="low"),
        dict(base, status="pending"),
        dict(base, status="succeeded", exit_code=1),
        dict(base, status="failed", exit_code=0),
        dict(base, status="unknown", exit_code=1),
        dict(base, status="interrupted", exit_code=1),
        dict(base, completion_reason="task-boundary"),
        dict(base, status="unknown", exit_code=None, completion_reason="process-exit"),
        dict(base, exit_code=True),
        dict(base, started_at="yesterday"),
        dict(base, duration_ms=-1),
        dict(base, duration_ms=True),
        dict(base, original_command_bytes=-1),
        dict(base, original_command_bytes=3, retained_command_bytes=4),
        dict(base, retained_command_bytes=3),
        dict(base, command_truncated=True),
        dict(base, command_truncated=True, original_command_bytes=len(base["command"].encode("utf-8")) + 1, retained_command_bytes=1),
        dict(base, command_truncated="false"),
        dict(base, capture_mode="terminal-output"),
        dict(base, is_trusted=1),
        dict(base, output_captured=True),
        dict(base, stdout="raw output"),
        dict(base, terminalOutput="raw output"),
        dict(base, environment={"PATH": "raw environment"}),
        dict(base, transcript="raw terminal transcript"),
        dict(base, future_metadata={"raw_output": "nested output"}),
        dict(base, cwd="C:/workspace"),
        dict(base, cwd="../outside"),
        dict(base, cwd="apps\\local-server"),
        dict(base, cwd="apps\nlocal-server"),
        dict(base, cwd="x" * 1025),
    ]
    missing_exit_code = copy.deepcopy(base); missing_exit_code.pop("exit_code")
    missing_output_contract = copy.deepcopy(base); missing_output_contract.pop("output_captured")
    invalid_payloads.extend([missing_exit_code, missing_output_contract])
    for index, payload in enumerate(invalid_payloads):
        event = terminal_event(f"invalid-{index}")
        event["payload"] = payload
        response = client.post(f"/tasks/{task['id']}/events/batch", headers=headers, json={"events": [event]})
        assert response.status_code == 422, (index, response.text)
        assert "echo\\ud800" not in response.text

    legacy = client.post("/events", headers=headers, json={
        "projectId": task["project_id"], "taskId": task["id"], "type": "terminal_command",
        "timestamp": "2026-08-09T01:02:04Z", "payload": {"command": "unbounded"},
    })
    assert legacy.status_code == 422


def test_context_excludes_terminal_command_and_evidence_when_commands_disabled(client, headers):
    task = active_task(client, headers)
    stored = client.post(f"/tasks/{task['id']}/events/batch", headers=headers, json={"events": [terminal_event(f"terminal-disabled-{task['id']}")]})
    assert stored.status_code == 200
    event_id = stored.json()["event_ids"][0]
    assert client.post(f"/tasks/{task['id']}/end", headers=headers).status_code == 200
    response = client.post(f"/tasks/{task['id']}/ai/context-packages", headers=headers, json={"config": {"estimated_input_token_budget": 32000, "include_commands_and_tasks": False}})
    assert response.status_code == 200
    context = response.json()["context"]
    assert context["commands_and_tasks"] == []
    assert context["statistics"]["terminal_commands"] == 0
    assert {"type": "terminal_command", "id": event_id} not in context["provenance"]["included_source_refs"]


def test_event_batch_and_task_end_are_serialized_by_the_write_transaction(client, headers, monkeypatch):
    task = active_task(client, headers)
    entered = threading.Event()
    release = threading.Event()
    original = main.event_task

    def blocked_event_task(task_id, connection):
        entered.set()
        assert release.wait(5)
        return original(task_id, connection)

    monkeypatch.setattr(main, "event_task", blocked_event_task)
    with ThreadPoolExecutor(max_workers=2) as executor:
        batch = executor.submit(
            client.post,
            f"/tasks/{task['id']}/events/batch",
            headers=headers,
            json={"events": [terminal_event(f"terminal-race-{task['id']}")]},
        )
        assert entered.wait(5)
        ending = executor.submit(client.post, f"/tasks/{task['id']}/end", headers=headers)
        time.sleep(0.1)
        assert ending.done() is False
        release.set()
        assert batch.result(timeout=5).status_code == 200
        assert ending.result(timeout=5).status_code == 200
