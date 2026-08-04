from __future__ import annotations

import os, sys, json
from fastapi.testclient import TestClient
import pytest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
import app.main as main
from app.main import app

@pytest.fixture()
def client(tmp_path):
    main.DB_PATH = tmp_path / "context.db"; main.TOKEN = "context-token"
    return TestClient(app)

@pytest.fixture()
def headers(): return {"Authorization": "Bearer context-token"}

def completed_task(client, headers):
    task=client.post("/tasks", headers=headers, json={"name":"Context", "project":"Context Project"}).json()
    client.post(f"/tasks/{task['id']}/events/batch", headers=headers, json={"events":[{"client_event_id":"note", "event_type":"manual_note", "occurred_at":"2026-01-01T00:00:00Z", "payload":{"text":"token=secret-value-123456"}}]})
    return client.post(f"/tasks/{task['id']}/end", headers=headers).json()

def test_context_package_lifecycle_and_idempotency(client, headers):
    task=completed_task(client,headers); url=f"/tasks/{task['id']}/ai/context-packages"
    body={"idempotency_key":"same-key", "config":{"estimated_input_token_budget":32000}}
    first=client.post(url,headers=headers,json=body); assert first.status_code == 200
    package=first.json(); assert package["id"] and package["status"] == "preview" and isinstance(package["estimated_tokens"], int)
    context=package["context"]; assert context["schema_version"] == "task-context-package/v1"
    assert all(isinstance(context[key], dict) for key in ("task", "privacy", "budget", "provenance"))
    assert "secret-value-123456" not in str(package)
    assert client.post(url,headers=headers,json=body).json()["id"] == package["id"]
    ready=client.post(f"/ai/context-packages/{package['id']}/ready",headers=headers)
    assert ready.status_code == 200 and ready.json()["status"] == "ready"
    assert client.get(url,headers=headers).json()["items"][0]["status"] == "ready"

def test_context_package_rejects_active_task(client, headers):
    task=client.post("/tasks",headers=headers,json={"name":"Active","project":"P"}).json()
    response=client.post(f"/tasks/{task['id']}/ai/context-packages",headers=headers,json={})
    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "task_not_completed"

def test_ready_rejects_empty_or_invalid_persisted_context(client, headers):
    task=completed_task(client,headers)
    response=client.post(f"/tasks/{task['id']}/ai/context-packages",headers=headers,json={})
    context_id=response.json()["id"]
    c=main.db(); c.execute("UPDATE ai_context_packages SET context_json=? WHERE id=?", (json.dumps({}), context_id)); c.commit()
    rejected=client.post(f"/ai/context-packages/{context_id}/ready",headers=headers)
    assert rejected.status_code == 400 and rejected.json()["detail"]["code"] == "context_invalid"

def test_token_statistics_remain_numeric_after_redaction(client, headers):
    task=completed_task(client,headers)
    package=client.post(f"/tasks/{task['id']}/ai/context-packages",headers=headers,json={}).json()
    assert isinstance(package["estimated_tokens"], int)
    assert isinstance(package["context"]["budget"]["estimated_tokens_after"], int)
    assert package["context"]["task"]["manual_notes"][0]["text"].endswith("<redacted:bearer-token>")
