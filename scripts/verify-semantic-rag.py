"""Offline Stage 11B end-to-end check using a disposable packaged EXE."""
from __future__ import annotations
import json,os,socket,subprocess,sys,tempfile,time,urllib.request
from pathlib import Path
from backend_lifecycle import assert_owned_backend_exited, start_owned_backend, stop_owned_backend
ROOT=Path(__file__).resolve().parents[1]; EXE=ROOT/'artifacts/backend/ai-worklog-server.exe'
def port():
    value=socket.socket();value.bind(('127.0.0.1',0));result=value.getsockname()[1];value.close();return result
def call(url,token,payload=None):
    data=json.dumps(payload).encode() if payload is not None else None; req=urllib.request.Request(url,data=data,headers={'Authorization':'Bearer '+token,'Content-Type':'application/json'});return json.loads(urllib.request.urlopen(req,timeout=10).read().decode())
def wait(url,token):
    for _ in range(50):
        try:return call(url,token)
        except Exception:time.sleep(.25)
    raise RuntimeError('backend not healthy')
def stop(proc, port, token):
    stop_owned_backend(proc,port=port,token=token);assert_owned_backend_exited(proc)
def main():
    if not EXE.exists():raise RuntimeError('run the packaged backend build first')
    with tempfile.TemporaryDirectory(prefix='stage11b-verify-') as raw:
        root=Path(raw); token='stage11b-verify'; backend_port=port(); fake_port=port(); env={**os.environ,'AI_WORKLOG_DATA_DIR':str(root),'WORKLOG_DB':str(root/'worklog.db'),'WORKLOG_KNOWLEDGE':str(root/'knowledge')}
        sys.path.insert(0,str(ROOT/'apps/local-server'));import app.main as main_db; main_db.DB_PATH=root/'worklog.db';main_db.KNOWLEDGE=root/'knowledge'; c=main_db.db();c.execute('INSERT INTO knowledge_publications VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',('published-login','task','revision',0,'Login recovery','development','Android login API token recovery using SQLite cache.','Use this for login failures.','published/development/login.md','hash','published','2026-08-07T00:00:00Z','2026-08-07T00:00:00Z','2026-08-07T00:00:00Z',None));c.close()
        fake=subprocess.Popen([sys.executable,str(ROOT/'scripts/fake-semantic-rag-provider.py')],env={**env,'FAKE_SEMANTIC_RAG_PORT':str(fake_port)},stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        server=start_owned_backend(EXE,environment={**env,'WORKLOG_PORT':str(backend_port),'WORKLOG_SESSION_TOKEN':token})
        try:
            health=wait('http://127.0.0.1:%s/health'%backend_port,token); profile={'id':'fake','name':'Fake','kind':'openai-compatible','base_url':'http://127.0.0.1:%s/v1'%fake_port,'model':'fake','dimensions':3,'timeout_seconds':10,'enabled':True,'api_key':'synthetic'}
            indexed=call('http://127.0.0.1:%s/knowledge/semantic-index/rebuild'%backend_port,token,profile); retrieved=call('http://127.0.0.1:%s/knowledge/retrieve'%backend_port,token,{'query':'login API','mode':'hybrid','limit':5,'embedding_profile':profile}); chat={'profile_id':'chat','provider':'openai-compatible','base_url':'http://127.0.0.1:%s/v1'%fake_port,'model':'fake','thinking_enabled':False,'timeout_seconds':10,'max_output_tokens':512,'api_key':'synthetic'}; answer=call('http://127.0.0.1:%s/knowledge/rag-answers'%backend_port,token,{'query':'How do I recover login?','mode':'hybrid','limit':5,'embedding_profile':profile,'chat_profile':chat}); assert indexed['indexed_chunks']==1 and retrieved['effective_mode']=='hybrid' and answer['citations'][0]['source_ref']=='knowledge-publication:published-login';stop(server,backend_port,token);server=start_owned_backend(EXE,environment={**env,'WORKLOG_PORT':str(backend_port),'WORKLOG_SESSION_TOKEN':token});wait('http://127.0.0.1:%s/health'%backend_port,token); restarted=call('http://127.0.0.1:%s/knowledge/retrieve'%backend_port,token,{'query':'login','mode':'semantic','limit':5,'embedding_profile':profile});assert restarted['items'][0]['publication_id']=='published-login';print(json.dumps({'status':'PASS','semantic':True,'hybrid':retrieved['effective_mode'],'rag_citation':answer['citations'][0]['source_ref'],'restart':restarted['items'][0]['publication_id']}))
        finally:
            stop(server,backend_port,token)
            if fake.poll() is None:
                fake.terminate()
                try: fake.wait(timeout=5)
                except subprocess.TimeoutExpired: fake.kill(); fake.wait(timeout=5)
if __name__=='__main__':main()
