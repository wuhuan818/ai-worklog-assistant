import os
import sys
import tempfile
import sqlite3
import threading
import time
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
    health = response.json()
    assert health['status'] == 'ok' and health['service'] == 'local-server'
    assert health['api_version'] == 'stage-09'
    assert 'ai-summary-generation-v1' in health['features']


def test_openapi_exposes_stage09_summary_generation_routes(client):
    paths = client.get('/openapi.json').json()['paths']
    assert '/ai/context-packages/{context_id}/summary-generations' in paths
    assert '/ai/generation-jobs/{job_id}' in paths
    assert '/ai/generation-jobs/{job_id}/cancel' in paths
    assert '/tasks/{task_id}/ai/summary-drafts' in paths
    assert '/ai/summary-drafts/{draft_id}' in paths


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
    assert bug['status'] == 'open'
    resolved = client.post('/bugs/%s/resolve' % bug['id'], headers=headers, json={'resolution_summary': 'fixed'})
    assert resolved.status_code == 200
    assert resolved.json()['status'] == 'resolved'


def test_bug_lifecycle_notes_resolutions_and_task_end_pause(client, headers):
    task = create_task(client, headers)
    base = f'/tasks/{task["id"]}/bugs'
    first = client.post(base, headers=headers, json={'title': 'A', 'severity': 'high'}).json()
    second = client.post(base, headers=headers, json={'title': 'B', 'severity': 'low'}).json()
    assert client.post(f'{base}/{first["id"]}/activate', headers=headers).json()['active_bug']['id'] == first['id']
    switched = client.post(f'{base}/{second["id"]}/activate', headers=headers).json()
    assert switched['paused_bug']['id'] == first['id'] and switched['active_bug']['id'] == second['id']
    note = client.post(f'{base}/{second["id"]}/notes', headers=headers, json={'client_note_id': 'note-1', 'text': 'check repro'})
    assert note.status_code == 200
    assert client.post(f'{base}/{second["id"]}/notes', headers=headers, json={'client_note_id': 'note-1', 'text': 'changed'}).json()['id'] == note.json()['id']
    assert client.post(f'{base}/{second["id"]}/resolve', headers=headers, json={'resolution_summary': 'fixed'}).json()['status'] == 'resolved'
    assert len(client.get(f'{base}/{second["id"]}/resolutions', headers=headers).json()['items']) == 1
    assert client.post(f'{base}/{second["id"]}/reopen', headers=headers).json()['status'] == 'open'
    client.post(f'{base}/{second["id"]}/activate', headers=headers)
    assert client.post(f'/tasks/{task["id"]}/end', headers=headers).status_code == 200
    assert client.get(f'{base}/{second["id"]}', headers=headers).json()['status'] == 'paused'
    assert client.post(base, headers=headers, json={'title': 'nope'}).status_code == 409


def test_bug_event_association_and_filter(client, headers):
    task = create_task(client, headers)
    base = f'/tasks/{task["id"]}/bugs'
    bug = client.post(base, headers=headers, json={'title': 'linked'}).json()
    payload = {'client_event_id': 'bug-event-1', 'event_type': 'file_saved', 'occurred_at': '2026-01-01T00:00:00Z', 'bugId': bug['id'], 'payload': {}}
    assert client.post(f'/tasks/{task["id"]}/events/batch', headers=headers, json={'events': [payload]}).status_code == 200
    listed = client.get(f'{base}/{bug["id"]}/events', headers=headers).json()
    assert listed['total'] == 1 and listed['items'][0]['bug_id'] == bug['id']
    assert client.post(f'/tasks/{task["id"]}/events/batch', headers=headers, json={'events': [{**payload, 'client_event_id': 'bad', 'bugId': 'missing'}]}).status_code == 422


def test_bug_migration_preserves_legacy_rows_and_repairs_duplicate_active(tmp_path):
    main.DB_PATH = tmp_path / 'legacy.db'
    c = sqlite3.connect(main.DB_PATH)
    c.executescript("""
      CREATE TABLE users(id TEXT PRIMARY KEY, name TEXT);
      CREATE TABLE projects(id TEXT PRIMARY KEY,user_id TEXT,name TEXT,slug TEXT UNIQUE);
      CREATE TABLE tasks(id TEXT PRIMARY KEY,user_id TEXT,project_id TEXT,name TEXT,description TEXT,requirement_id TEXT,tags TEXT,status TEXT,started_at TEXT,ended_at TEXT);
      CREATE TABLE bugs(id TEXT PRIMARY KEY,user_id TEXT,task_id TEXT,title TEXT,status TEXT,created_at TEXT,resolved_at TEXT,notes TEXT,root_cause TEXT,solution TEXT);
      INSERT INTO users VALUES ('local-user','Local User');
      INSERT INTO projects VALUES ('p','local-user','P','p');
      INSERT INTO tasks VALUES ('t','local-user','p','T','','','[]','active','2026-01-01T00:00:00+00:00',NULL);
      INSERT INTO bugs VALUES ('a','local-user','t','A','active','2026-01-01T00:00:00+00:00',NULL,'','','');
      INSERT INTO bugs VALUES ('b','local-user','t','B','active','2026-01-02T00:00:00+00:00',NULL,'','','');
    """)
    c.commit(); c.close()
    migrated = main.db()
    assert migrated.execute("SELECT COUNT(*) FROM bugs WHERE task_id='t'").fetchone()[0] == 2
    assert migrated.execute("SELECT COUNT(*) FROM bugs WHERE task_id='t' AND status='active'").fetchone()[0] == 1
    assert migrated.execute("SELECT project_id FROM bugs WHERE id='a'").fetchone()[0] == 'p'


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


def test_project_workspace_identity_and_list_order(client, headers):
    first = client.post('/projects', headers=headers, json={'name': '  Lifecycle  ', 'workspace_path': 'C:\\work'}).json()
    duplicate = client.post('/projects', headers=headers, json={'name': 'lifecycle', 'workspace_path': 'C:\\work'}).json()
    other = client.post('/projects', headers=headers, json={'name': 'Lifecycle', 'workspace_path': 'C:\\other'}).json()
    assert first['id'] == duplicate['id']
    assert other['id'] != first['id']
    assert client.get('/projects', headers=headers).status_code == 200


def test_identity_resolution_is_stable_and_does_not_merge_same_names(client, headers):
    first = client.post('/projects/resolve', headers=headers, json={'name': 'API', 'workspace_path': 'D:\\Work\\API', 'workspace_identity_key': 'a' * 64, 'workspace_identity_version': 1, 'workspace_kind': 'folder', 'canonical_workspace_uri': 'file:///d:/work/api'}).json()
    again = client.post('/projects/resolve', headers=headers, json={'name': 'Renamed', 'workspace_path': 'd:/work/api/', 'workspace_identity_key': 'a' * 64, 'workspace_identity_version': 1, 'workspace_kind': 'folder'}).json()
    other = client.post('/projects/resolve', headers=headers, json={'name': 'API', 'workspace_path': 'D:\\Other\\API', 'workspace_identity_key': 'b' * 64, 'workspace_identity_version': 1, 'workspace_kind': 'folder'}).json()
    assert first['created'] is True
    assert again['created'] is False and again['project']['id'] == first['project']['id']
    assert other['project']['id'] != first['project']['id']


def test_identity_resolution_is_atomic(client, headers):
    responses = []
    def resolve():
        responses.append(client.post('/projects/resolve', headers=headers, json={'name': 'Concurrent identity', 'workspace_path': 'D:\\Concurrent', 'workspace_identity_key': 'c' * 64, 'workspace_identity_version': 1, 'workspace_kind': 'folder'}))
    threads = [threading.Thread(target=resolve) for _ in range(2)]
    [thread.start() for thread in threads]; [thread.join() for thread in threads]
    assert all(response.status_code == 200 for response in responses)
    assert len({response.json()['project']['id'] for response in responses}) == 1


def test_task_lifecycle_active_end_duration_and_persistence(client, headers, tmp_path):
    project = client.post('/projects', headers=headers, json={'name': 'Persistent'}).json()
    started = client.post('/tasks', headers=headers, json={'name': 'Lifecycle', 'project_id': project['id'], 'tags': [' ui ', 'UI', 'backend']}).json()
    assert started['status'] == 'active' and started['tags'] == ['ui', 'backend']
    assert client.get('/tasks/active', headers=headers).json()['task']['id'] == started['id']
    assert client.get('/tasks/%s' % started['id'], headers=headers).json()['id'] == started['id']
    time.sleep(1.1)
    ended = client.post('/tasks/%s/end' % started['id'], headers=headers).json()
    assert ended['status'] == 'completed' and ended['ended_at'] and ended['duration_seconds'] >= 1
    assert client.get('/tasks/active', headers=headers).json() == {'task': None}
    assert client.post('/tasks/%s/end' % started['id'], headers=headers).status_code == 409
    assert sqlite3.connect(main.DB_PATH).execute('SELECT COUNT(*) FROM projects').fetchone()[0] == 1
    assert sqlite3.connect(main.DB_PATH).execute('SELECT status,duration_seconds FROM tasks').fetchone()[0:2] == ('completed', 1)


def test_active_task_conflict_and_missing_end(client, headers):
    first = create_task(client, headers)
    conflict = client.post('/tasks', headers=headers, json={'name': 'Second', 'project': 'sample'})
    assert conflict.status_code == 409 and first['name'] in conflict.json()['detail'] and first['id'] in conflict.json()['detail']
    assert client.post('/tasks/not-found/end', headers=headers).status_code == 404


def test_restart_reads_same_sqlite_state(client, headers, tmp_path):
    task = create_task(client, headers)
    db_path = main.DB_PATH
    main.DB_PATH = db_path
    restarted = TestClient(app)
    recovered = restarted.get('/tasks/active', headers=headers).json()
    assert recovered['task']['id'] == task['id'] and recovered['task']['started_at'] == task['started_at']


def test_active_task_empty_and_cross_user_task_is_hidden(client, headers):
    assert client.get('/tasks/active', headers=headers).status_code == 200
    assert client.get('/tasks/active', headers=headers).json() == {'task': None}
    assert client.get('/tasks/missing', headers=headers).status_code == 404


def test_concurrent_starts_allow_only_one_active_task(client, headers):
    project = client.post('/projects', headers=headers, json={'name': 'Concurrent'}).json()
    results = []

    def start(name):
        results.append(client.post('/tasks', headers=headers, json={'name': name, 'project_id': project['id']}))

    threads = [threading.Thread(target=start, args=(f'Task {index}',)) for index in range(2)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    assert sorted(response.status_code for response in results) == [200, 409]
    assert client.get('/tasks/active', headers=headers).json()['task']['status'] == 'active'
