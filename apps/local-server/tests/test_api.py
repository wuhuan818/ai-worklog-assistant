import os
import sys
import tempfile
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
import app.main as main
from app.main import app


@pytest.fixture()
def client(tmp_path):
    main.DB_PATH = tmp_path / 'test.db'
    main.KNOWLEDGE = tmp_path / 'knowledge'
    main.TOKEN = 'test-token'
    return TestClient(app)


@pytest.fixture()
def headers():
    return {'Authorization': 'Bearer test-token'}


def create_task(client, headers):
    response = client.post('/tasks', headers=headers, json={'name': 'Demo', 'project': 'sample'})
    assert response.status_code == 200
    return response.json()


def test_health_check(client):
    response = client.get('/health')
    assert response.status_code == 200
    assert response.json() == {'status': 'ok', 'service': 'local-server'}


def test_session_token_is_required(client):
    assert client.get('/projects').status_code == 401
    assert client.get('/projects', headers={'Authorization': 'Bearer wrong'}).status_code == 401


def test_create_project(client, headers):
    response = client.post('/projects', headers=headers, json={'name': 'Verification Project'})
    assert response.status_code == 200
    assert response.json()['name'] == 'Verification Project'
    assert client.get('/projects', headers=headers).json()[0]['slug'] == 'verification-project'


def test_create_task_and_event(client, headers):
    task = create_task(client, headers)
    assert task['status'] == 'active'
    event = client.post('/events', headers=headers, json={
        'projectId': task['project_id'], 'taskId': task['id'], 'type': 'file_saved',
        'timestamp': '2026-01-01T00:00:00Z', 'payload': {'file': 'main.py'},
    })
    assert event.status_code == 200
    assert client.get('/tasks/%s/events' % task['id'], headers=headers).json()[0]['type'] == 'file_saved'


def test_create_and_resolve_bug(client, headers):
    task = create_task(client, headers)
    bug = client.post('/tasks/%s/bugs' % task['id'], headers=headers, json={'title': 'broken test'}).json()
    assert bug['status'] == 'active'
    resolved = client.post('/bugs/%s/resolve' % bug['id'], headers=headers)
    assert resolved.status_code == 200
    assert resolved.json()['status'] == 'resolved'


def test_mock_summary_update_confirm_markdown_and_search(client, headers):
    task = create_task(client, headers)
    draft = client.post('/tasks/%s/summaries/generate' % task['id'], headers=headers).json()
    assert draft['status'] == 'draft'
    assert 'taskSummary' in draft['content']
    changed = dict(draft['content'])
    changed['taskSummary'] = 'Reviewed verification summary'
    assert client.put('/summaries/%s' % draft['id'], headers=headers, json={'content': changed}).json()['ok']
    confirmed = client.post('/summaries/%s/confirm' % draft['id'], headers=headers)
    assert confirmed.json() == {'ok': True, 'status': 'confirmed'}
    assert list(main.KNOWLEDGE.rglob('*.md'))
    hits = client.get('/knowledge/search?q=Reviewed', headers=headers).json()
    assert hits and 'Reviewed verification summary' in hits[0]['content']
    assert client.get('/tasks/%s' % task['id'], headers=headers).json()['status'] == 'confirmed'


def test_sensitive_information_is_redacted(client, headers):
    task = create_task(client, headers)
    response = client.post('/events', headers=headers, json={
        'projectId': task['project_id'], 'taskId': task['id'], 'type': 'terminal_output',
        'timestamp': '2026-01-01T00:00:00Z',
        'payload': {'api_key': 'real-key', 'nested': {'password': 'pw'}, 'text': 'sk-123456789012345'},
    })
    assert response.status_code == 200
    stored = client.get('/tasks/%s/events' % task['id'], headers=headers).json()[0]['payload']
    assert stored['api_key'] == '[REDACTED]'
    assert stored['nested']['password'] == '[REDACTED]'
    assert stored['text'] == '[REDACTED]'
