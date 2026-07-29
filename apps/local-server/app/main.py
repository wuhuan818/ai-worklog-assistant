from __future__ import annotations
import hashlib, json, os, re, secrets, sqlite3, uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional
from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, Field

ROOT = Path(__file__).resolve().parents[3]
USER_DATA_DIR = Path(os.getenv('WORKLOG_DATA_DIR', Path.home() / 'AppData' / 'Local' / 'AIWorklogAssistant'))
DB_PATH = Path(os.getenv('WORKLOG_DB', USER_DATA_DIR / 'worklog.db'))
KNOWLEDGE = Path(os.getenv('WORKLOG_KNOWLEDGE', USER_DATA_DIR / 'knowledge'))
TOKEN = os.getenv('WORKLOG_SESSION_TOKEN', 'dev-token')
HOST = os.getenv('WORKLOG_HOST', '127.0.0.1')
PORT = int(os.getenv('WORKLOG_PORT', '8765'))
app = FastAPI(title='AI Worklog Assistant', version='0.1.0')

def now() -> str: return datetime.now(timezone.utc).isoformat()
def db():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    c = sqlite3.connect(DB_PATH); c.row_factory = sqlite3.Row
    c.executescript('''CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, name TEXT); CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY, user_id TEXT, name TEXT, slug TEXT UNIQUE); CREATE TABLE IF NOT EXISTS tasks(id TEXT PRIMARY KEY,user_id TEXT,project_id TEXT,name TEXT,description TEXT,requirement_id TEXT,tags TEXT,status TEXT,started_at TEXT,ended_at TEXT); CREATE TABLE IF NOT EXISTS bugs(id TEXT PRIMARY KEY,user_id TEXT,task_id TEXT,title TEXT,status TEXT,created_at TEXT,resolved_at TEXT,notes TEXT,root_cause TEXT,solution TEXT); CREATE TABLE IF NOT EXISTS events(id TEXT PRIMARY KEY,user_id TEXT,project_id TEXT,task_id TEXT,bug_id TEXT,type TEXT,timestamp TEXT,payload TEXT,sensitivity TEXT); CREATE TABLE IF NOT EXISTS summary_drafts(id TEXT PRIMARY KEY,task_id TEXT,status TEXT,content TEXT,created_at TEXT,updated_at TEXT); CREATE TABLE IF NOT EXISTS knowledge_entries(id TEXT PRIMARY KEY,task_id TEXT,type TEXT,title TEXT,content TEXT,source_file TEXT);''')
    c.execute('INSERT OR IGNORE INTO users VALUES (?,?)', ('local-user','Local User')); c.commit(); return c
def auth(authorization: Optional[str]):
    if authorization != f'Bearer {TOKEN}': raise HTTPException(401, 'Invalid session token')
class ProjectIn(BaseModel): name: str = Field(min_length=1)
class TaskIn(BaseModel): name: str; project: str; description: str = ''; requirement_id: str = ''; tags: List[str] = []
class BugIn(BaseModel): title: str
class EventIn(BaseModel): userId: str='local-user'; projectId: str; taskId: str; bugId: Optional[str]=None; source: str='vscode'; type: str; timestamp: str; payload: Dict[str,Any]={}; sensitivity: str='normal'
class SummaryIn(BaseModel): content: Dict[str,Any]
class SessionIn(BaseModel): token: str; model: Optional[str]=None; base_url: Optional[str]=None; api_key: Optional[str]=None

@app.get('/health')
def health(): return {'status':'ok','service':'local-server'}
@app.post('/session/initialize')
def initialize(x: SessionIn):
    global TOKEN; TOKEN=x.token; return {'ok':True}
@app.get('/projects')
def projects(authorization: Optional[str]=Header(None)):
    auth(authorization); return [dict(r) for r in db().execute('SELECT * FROM projects WHERE user_id=? ORDER BY name',('local-user',))]
@app.post('/projects')
def create_project(x: ProjectIn, authorization: Optional[str]=Header(None)):
    auth(authorization); pid=str(uuid.uuid4()); slug=re.sub(r'[^a-z0-9]+','-',x.name.lower()).strip('-') or pid[:8]; c=db(); c.execute('INSERT OR IGNORE INTO projects VALUES (?,?,?,?)',(pid,'local-user',x.name,slug)); c.commit(); return dict(c.execute('SELECT * FROM projects WHERE slug=?',(slug,)).fetchone())
@app.post('/tasks')
def create_task(x: TaskIn, authorization: Optional[str]=Header(None)):
    auth(authorization); c=db(); row=c.execute('SELECT * FROM projects WHERE name=? AND user_id=?',(x.project,'local-user')).fetchone();
    if not row: row=create_project(ProjectIn(name=x.project), authorization)
    pid=row['id'] if isinstance(row,sqlite3.Row) else row['id']; tid=str(uuid.uuid4()); started=now(); c.execute('INSERT INTO tasks VALUES (?,?,?,?,?,?,?,?,?,?)',(tid,'local-user',pid,x.name,x.description,x.requirement_id,json.dumps(x.tags,ensure_ascii=False),'active',started,None)); c.commit(); return task(tid,authorization)
@app.get('/tasks/{task_id}')
def task(task_id: str, authorization: Optional[str]=Header(None)):
    auth(authorization); r=db().execute('SELECT * FROM tasks WHERE id=?',(task_id,)).fetchone();
    if not r: raise HTTPException(404,'Task not found')
    out=dict(r); out['tags']=json.loads(out['tags']); return out
@app.post('/tasks/{task_id}/end')
def end_task(task_id: str, authorization: Optional[str]=Header(None)):
    auth(authorization); c=db(); c.execute('UPDATE tasks SET status=?,ended_at=? WHERE id=?',('review',now(),task_id)); c.commit(); return task(task_id,authorization)
@app.get('/tasks/{task_id}/events')
def events(task_id: str, authorization: Optional[str]=Header(None)):
    auth(authorization); return [dict(dict(r), payload=json.loads(r['payload'])) for r in db().execute('SELECT * FROM events WHERE task_id=? ORDER BY timestamp',(task_id,))]
@app.post('/events')
def add_event(x: EventIn, authorization: Optional[str]=Header(None)):
    auth(authorization); c=db(); eid=x.__dict__.get('id') or str(uuid.uuid4()); c.execute('INSERT INTO events VALUES (?,?,?,?,?,?,?,?,?)',(eid,x.userId,x.projectId,x.taskId,x.bugId,x.type,x.timestamp,json.dumps(filter_sensitive(x.payload),ensure_ascii=False),x.sensitivity)); c.commit(); return {'id':eid}
@app.post('/tasks/{task_id}/bugs')
def create_bug(task_id: str,x: BugIn,authorization: Optional[str]=Header(None)):
    auth(authorization); bid=str(uuid.uuid4()); c=db(); c.execute('INSERT INTO bugs VALUES (?,?,?,?,?,?,?,?,?,?)',(bid,'local-user',task_id,x.title,'active',now(),None,'','','')); c.commit(); return bug(bid,authorization)
@app.get('/tasks/{task_id}/bugs')
def bugs(task_id:str,authorization:Optional[str]=Header(None)):
    auth(authorization); return [dict(r) for r in db().execute('SELECT * FROM bugs WHERE task_id=? ORDER BY created_at',(task_id,))]
@app.post('/bugs/{bug_id}/resolve')
def resolve_bug(bug_id:str,authorization:Optional[str]=Header(None)):
    auth(authorization); c=db(); c.execute('UPDATE bugs SET status=?,resolved_at=? WHERE id=?',('resolved',now(),bug_id)); c.commit(); return bug(bug_id,authorization)
def bug(bug_id,authorization):
    r=db().execute('SELECT * FROM bugs WHERE id=?',(bug_id,)).fetchone();
    if not r: raise HTTPException(404,'Bug not found')
    return dict(r)
def filter_sensitive(value: Any):
    if isinstance(value, dict):
        return {k: ('[REDACTED]' if re.search(r'(?i)(api[_-]?key|token|password|secret|authorization)', k) else filter_sensitive(v)) for k, v in value.items()}
    if isinstance(value, list): return [filter_sensitive(v) for v in value]
    if isinstance(value, str): return re.sub(r'(?i)sk-[A-Za-z0-9_-]{10,}', '[REDACTED]', value)
    return value
def mock_summary(tid):
    c=db(); t=dict(c.execute('SELECT * FROM tasks WHERE id=?',(tid,)).fetchone()); bs=[dict(r) for r in c.execute('SELECT * FROM bugs WHERE task_id=?',(tid,))]; es=[dict(r) for r in c.execute('SELECT * FROM events WHERE task_id=?',(tid,))]; cmds=[json.loads(e['payload']).get('command') for e in es if e['type']=='terminal_command' and json.loads(e['payload']).get('command')]; unresolved=[b['title'] for b in bs if b['status']!='resolved'];
    return {'taskSummary':f"完成任务：{t['name']}。共记录 {len(es)} 条工作事件。",'codeChangeSummary':'基于文件保存事件生成的代码修改记录。','importantCommands':cmds,'bugSolutions':[{'bugId':b['id'],'title':b['title'],'rootCause':'通过事件和人工备注复盘。','solution':b['solution'] or '已由用户标记解决。'} for b in bs if b['status']=='resolved'],'unresolvedIssues':unresolved,'nextTodos':['补充自动化测试'] if unresolved else [],'dailyReportEntry':f"{t['name']}：完成开发并完成工作记录审核。",'knowledgeCandidates':[{'title':f"{t['name']} 工作记录",'content':f"{t['name']} 的经验记录。",'type':'task','include':True}]}
@app.post('/tasks/{task_id}/summaries/generate')
def generate(task_id:str,authorization:Optional[str]=Header(None)):
    auth(authorization); sid=str(uuid.uuid4()); content=mock_summary(task_id); c=db(); c.execute('INSERT INTO summary_drafts VALUES (?,?,?,?,?,?)',(sid,task_id,'draft',json.dumps(content,ensure_ascii=False),now(),now())); c.commit(); return {'id':sid,'task_id':task_id,'status':'draft','content':content}
@app.get('/tasks/{task_id}/summaries/latest')
def latest(task_id:str,authorization:Optional[str]=Header(None)):
    auth(authorization); r=db().execute('SELECT * FROM summary_drafts WHERE task_id=? ORDER BY created_at DESC LIMIT 1',(task_id,)).fetchone(); out=dict(r) if r else None; out['content']=json.loads(out['content']) if out else None; return out
@app.put('/summaries/{summary_id}')
def update_summary(summary_id:str,x:SummaryIn,authorization:Optional[str]=Header(None)):
    auth(authorization); c=db(); c.execute('UPDATE summary_drafts SET content=?,updated_at=? WHERE id=?',(json.dumps(x.content,ensure_ascii=False),now(),summary_id)); c.commit(); return {'ok':True}
@app.post('/summaries/{summary_id}/confirm')
def confirm(summary_id:str,authorization:Optional[str]=Header(None)):
    auth(authorization); c=db(); r=c.execute('SELECT * FROM summary_drafts WHERE id=?',(summary_id,)).fetchone();
    if not r: raise HTTPException(404,'Summary not found')
    content=json.loads(r['content']); t=dict(c.execute('SELECT * FROM tasks WHERE id=?',(r['task_id'],)).fetchone()); slug=c.execute('SELECT slug FROM projects WHERE id=?',(t['project_id'],)).fetchone()['slug']; project=KNOWLEDGE/'projects'/slug; (KNOWLEDGE/'daily-records').mkdir(parents=True,exist_ok=True); (project/'task-records').mkdir(parents=True,exist_ok=True); (project/'bugs').mkdir(parents=True,exist_ok=True); (project/'solutions').mkdir(parents=True,exist_ok=True); marker=f'<!-- worklog:{r["task_id"]} -->'; text=marker+'\n# '+t['name']+'\n\n'+content.get('taskSummary','')+'\n\n## 修改\n'+content.get('codeChangeSummary','')+'\n'; (project/'task-records'/f'{t["id"]}.md').write_text(text,encoding='utf-8'); (KNOWLEDGE/'daily-records'/f'{datetime.now().date()}.md').write_text(marker+'\n'+content.get('dailyReportEntry','')+'\n',encoding='utf-8'); c.execute('UPDATE summary_drafts SET status=?,updated_at=? WHERE id=?',('confirmed',now(),summary_id)); c.execute('UPDATE tasks SET status=? WHERE id=?',('confirmed',r['task_id'])); c.commit(); return {'ok':True,'status':'confirmed'}
@app.get('/knowledge/search')
def search(q:str,authorization:Optional[str]=Header(None)):
    auth(authorization); hits=[]
    if KNOWLEDGE.exists():
        for p in KNOWLEDGE.rglob('*.md'):
            text=p.read_text(encoding='utf-8');
            if q.lower() in text.lower():
                try: source = str(p.relative_to(ROOT))
                except ValueError: source = str(p)
                hits.append({'source_file':source,'content':text[:1000]})
    return hits
@app.post('/knowledge/ask')
def ask(q:str,authorization:Optional[str]=Header(None)):
    auth(authorization); return {'answer':'未配置模型，以下为关键词检索结果。','sources':search(q,authorization)}

if __name__ == '__main__':
    import uvicorn
    db()
    uvicorn.run(app, host=HOST, port=PORT, log_level='warning')
