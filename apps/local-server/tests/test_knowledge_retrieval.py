import os
import sys

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
import app.main as main
from app.main import app
from app.ai.retrieval import service


@pytest.fixture()
def client(tmp_path):
    main.DB_PATH = tmp_path / 'retrieval.db'
    main.KNOWLEDGE = tmp_path / 'knowledge'
    main.TOKEN = 'retrieval-token'
    return TestClient(app)


@pytest.fixture()
def headers():
    return {'Authorization': 'Bearer retrieval-token'}


def seed():
    c = main.db()
    rows = [
        ('pub-login', 'task-a', 'rev-a', 0, '登录 API 排障', '开发', 'Android 登录调用 SQLite 缓存与 API 重试。', '适用于登录失败和 SQLite Bug。', 'published/a.md', 'hash-a', 'published', '2026-08-01T00:00:00+00:00', '2026-08-01T00:00:00+00:00', '2026-08-01T00:00:00+00:00', None),
        ('pub-build', 'task-b', 'rev-b', 0, 'VS Code 构建流程', '工程', '使用 npm 编译 TypeScript API 客户端。', '适用于 VS Code extension build。', 'published/b.md', 'hash-b', 'published', '2026-08-02T00:00:00+00:00', '2026-08-02T00:00:00+00:00', '2026-08-02T00:00:00+00:00', None),
        ('pub-old', 'task-a', 'rev-a', 0, '旧登录方案', '开发', '不应被检索。', '已被替代。', 'published/old.md', 'hash-old', 'superseded', '2026-07-01T00:00:00+00:00', '2026-08-03T00:00:00+00:00', '2026-07-01T00:00:00+00:00', '2026-08-03T00:00:00+00:00'),
    ]
    c.executemany('INSERT INTO knowledge_publications VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', rows)
    service.reconcile(c)
    return c


def test_local_retrieval_chinese_english_ranking_and_provenance(client, headers):
    seed()
    chinese = client.get('/knowledge/search?q=登录', headers=headers).json()['items']
    assert chinese[0]['publication_id'] == 'pub-login'
    assert chinese[0]['source_ref'] == 'knowledge-publication:pub-login'
    assert 'SQLite' in chinese[0]['snippet']
    english = client.get('/knowledge/search?q=Android API', headers=headers).json()['items']
    assert english[0]['publication_id'] == 'pub-login'
    mixed = client.get('/knowledge/search?q=VS Code', headers=headers).json()['items']
    assert mixed[0]['publication_id'] == 'pub-build'


def test_retrieval_excludes_superseded_filters_and_is_safe(client, headers):
    seed()
    assert [x['publication_id'] for x in client.get('/knowledge/search?q=登录', headers=headers).json()['items']] == ['pub-login']
    assert client.get('/knowledge/search?q=登录&category=工程', headers=headers).json()['items'] == []
    assert client.get('/knowledge/search?q=%22%20OR%20*', headers=headers).status_code == 200
    assert client.get('/knowledge/search?q=' + ('x' * 201), headers=headers).status_code == 422
    assert client.get('/knowledge/search?q=不存在', headers=headers).json()['items'] == []


def test_rebuild_is_idempotent_and_restart_recovers_index(client, headers):
    c = seed()
    assert service.reconcile(c) == 2
    assert c.execute('SELECT COUNT(*) FROM knowledge_search_index').fetchone()[0] == 2
    # A fresh connection simulates backend restart; startup reconciliation preserves results.
    assert client.get('/knowledge/search?q=SQLite', headers=headers).json()['items'][0]['publication_id'] == 'pub-login'
