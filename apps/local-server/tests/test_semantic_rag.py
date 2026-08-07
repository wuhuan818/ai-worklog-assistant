import asyncio, os, sys
import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
import app.main as main
from app.main import app
from app.ai.semantic import service

PROFILE={'id':'embed','name':'Fake','kind':'openai-compatible','base_url':'https://fake.invalid/v1','model':'fake-embed','dimensions':3,'timeout_seconds':5,'enabled':True}

@pytest.fixture()
def client(tmp_path):
    main.DB_PATH=tmp_path/'semantic.db'; main.KNOWLEDGE=tmp_path/'knowledge'; main.TOKEN='semantic-token'; return TestClient(app)
@pytest.fixture()
def headers(): return {'Authorization':'Bearer semantic-token'}
def seed():
    c=main.db(); rows=[('alpha','t1','r1',0,'登录方案','开发','Android login API SQLite token','reusable login fix','published/a.md','ha','published','2026-08-07T00:00:00Z','2026-08-07T00:00:00Z','2026-08-07T00:00:00Z',None),('beta','t2','r2',0,'构建指南','工程','VS Code TypeScript build','reusable build fix','published/b.md','hb','published','2026-08-06T00:00:00Z','2026-08-06T00:00:00Z','2026-08-06T00:00:00Z',None),('old','t1','r0',0,'旧登录','开发','old login','old','published/old.md','ho','superseded','2026-08-05T00:00:00Z','2026-08-05T00:00:00Z','2026-08-05T00:00:00Z','2026-08-06T00:00:00Z')]; c.executemany('INSERT INTO knowledge_publications VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',rows); return c

def test_semantic_hybrid_and_fallback(monkeypatch,tmp_path):
    main.DB_PATH=tmp_path/'semantic-direct.db'; main.KNOWLEDGE=tmp_path/'knowledge'; main.TOKEN='semantic-token'
    async def fake_embed(profile,key,values): return [[1.,0.,0.] if '登录' in value or 'login' in value.lower() else [0.,1.,0.] for value in values]
    monkeypatch.setattr(service,'embed',fake_embed); c=seed(); service.lexical.reconcile(c,force=True); result=asyncio.run(service.rebuild(c,PROFILE,'secret','now')); assert result['indexed_chunks']==2
    semantic=asyncio.run(service.retrieve(c,'登录','semantic',5,None,PROFILE,'secret')); assert semantic['items'][0]['publication_id']=='alpha'
    hybrid=asyncio.run(service.retrieve(c,'login API','hybrid',5,None,PROFILE,'secret')); assert hybrid['effective_mode']=='hybrid' and hybrid['items'][0]['publication_id']=='alpha'
    async def broken(*args): raise service.SemanticError('embedding_timeout','x')
    monkeypatch.setattr(service,'embed',broken); fallback=asyncio.run(service.retrieve(c,'login','hybrid',5,None,PROFILE,'secret')); assert fallback['effective_mode']=='lexical_fallback' and fallback['items'][0]['publication_id']=='alpha'

def test_semantic_api_profile_does_not_persist_secret(client,headers,monkeypatch):
    async def fake_embed(profile,key,values): return [[1.,0.,0.] for _ in values]
    monkeypatch.setattr(service,'embed',fake_embed); seed()
    body={**PROFILE,'api_key':'super-secret'}
    assert client.post('/knowledge/semantic-index/rebuild',headers=headers,json=body).status_code==200
    c=main.db(); dump=' '.join(str(tuple(row)) for row in c.execute("SELECT * FROM semantic_index_status")) + ' ' + ' '.join(str(tuple(row)) for row in c.execute("SELECT * FROM knowledge_embedding_chunks"))
    assert 'super-secret' not in dump
