import os, tempfile
import sys
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
from fastapi.testclient import TestClient
from app.main import app
import app.main as main

def test_flow():
    f=tempfile.NamedTemporaryFile(suffix='.db',delete=False); f.close(); main.DB_PATH=main.Path(f.name); main.KNOWLEDGE=main.Path(tempfile.mkdtemp()); main.TOKEN='test-token'; c=TestClient(app); h={'Authorization':'Bearer test-token'}
    assert c.get('/health').json()['status']=='ok'; t=c.post('/tasks',headers=h,json={'name':'Demo','project':'sample'}).json(); assert t['status']=='active'
    assert c.post('/events',headers=h,json={'projectId':t['project_id'],'taskId':t['id'],'type':'terminal_command','timestamp':'2026-01-01T00:00:00Z','payload':{'command':'pytest','token':'secret'}}).status_code==200
    b=c.post(f"/tasks/{t['id']}/bugs",headers=h,json={'title':'broken test'}).json(); assert c.post(f"/bugs/{b['id']}/resolve",headers=h).json()['status']=='resolved'
    s=c.post(f"/tasks/{t['id']}/summaries/generate",headers=h).json(); assert 'taskSummary' in s['content']; assert c.post(f"/summaries/{s['id']}/confirm",headers=h).json()['ok']; assert c.get('/knowledge/search?q=Demo',headers=h).json()
