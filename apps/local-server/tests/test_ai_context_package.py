from __future__ import annotations

import os, sys
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
    package=first.json(); assert package["schema_version"] == "task-context-package/v1"
    assert "secret-value-123456" not in str(package)
    assert client.post(url,headers=headers,json=body).json()["context_id"] == package["context_id"]
    ready=client.post(f"/ai/context-packages/{package['context_id']}/ready",headers=headers)
    assert ready.status_code == 200 and ready.json()["status"] == "ready"
    assert client.get(url,headers=headers).json()["items"][0]["status"] == "ready"

def test_context_package_rejects_active_task(client, headers):
    task=client.post("/tasks",headers=headers,json={"name":"Active","project":"P"}).json()
    response=client.post(f"/tasks/{task['id']}/ai/context-packages",headers=headers,json={})
    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "task_not_completed"
