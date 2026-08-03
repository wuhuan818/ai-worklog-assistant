from __future__ import annotations
import asyncio, ctypes, hashlib, json, os, re, secrets, sqlite3, threading, uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional
from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, Field, ValidationError, validator
from app.ai.context.models import ContextBuildRequest

ROOT = Path(__file__).resolve().parents[3]
USER_DATA_DIR = Path(os.getenv('AI_WORKLOG_DATA_DIR') or os.getenv('WORKLOG_DATA_DIR') or Path.home() / 'AppData' / 'Local' / 'AIWorklogAssistant').expanduser().resolve()
# Keep the legacy filename so Stage 2-5 isolated verifiers remain compatible;
# the enclosing directory is now always explicit and stable.
DB_PATH = Path(os.getenv('WORKLOG_DB', USER_DATA_DIR / 'worklog.db')).expanduser().resolve()
KNOWLEDGE = Path(os.getenv('WORKLOG_KNOWLEDGE', USER_DATA_DIR / 'knowledge'))
TOKEN = os.getenv('WORKLOG_SESSION_TOKEN', 'dev-token')
HOST = os.getenv('WORKLOG_HOST', '127.0.0.1')
PORT = int(os.getenv('WORKLOG_PORT', '8765'))
BACKEND_GENERATION = int(os.getenv('WORKLOG_BACKEND_GENERATION', '0'))
PARENT_PID = int(os.getenv('WORKLOG_EXTENSION_HOST_PID', '0'))
app = FastAPI(title='AI Worklog Assistant', version='0.1.0')
from app.ai.router import router as ai_router
app.include_router(ai_router)

def now() -> str: return datetime.now(timezone.utc).isoformat()
def normalize_workspace(value: Optional[str]) -> str:
    if not value: return ''
    value = value.strip().replace('file:///', '').replace('/', '\\')
    return os.path.normcase(os.path.normpath(value)).rstrip('\\')
def db():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    c = sqlite3.connect(DB_PATH, timeout=10, isolation_level=None); c.row_factory = sqlite3.Row
    c.executescript('''
      PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, name TEXT);
      CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY, user_id TEXT, name TEXT, slug TEXT UNIQUE);
      CREATE TABLE IF NOT EXISTS tasks(id TEXT PRIMARY KEY,user_id TEXT,project_id TEXT,name TEXT,description TEXT,requirement_id TEXT,tags TEXT,status TEXT,started_at TEXT,ended_at TEXT);
      CREATE TABLE IF NOT EXISTS bugs(id TEXT PRIMARY KEY,user_id TEXT,task_id TEXT,title TEXT,status TEXT,created_at TEXT,resolved_at TEXT,notes TEXT,root_cause TEXT,solution TEXT);
      CREATE TABLE IF NOT EXISTS bug_notes(id TEXT PRIMARY KEY, client_note_id TEXT NOT NULL UNIQUE, user_id TEXT NOT NULL, task_id TEXT NOT NULL, bug_id TEXT NOT NULL, text TEXT NOT NULL, created_at TEXT NOT NULL, FOREIGN KEY(bug_id) REFERENCES bugs(id), FOREIGN KEY(task_id) REFERENCES tasks(id));
      CREATE TABLE IF NOT EXISTS bug_resolutions(id TEXT PRIMARY KEY, user_id TEXT NOT NULL, task_id TEXT NOT NULL, bug_id TEXT NOT NULL, resolution_summary TEXT NOT NULL, root_cause TEXT, verification TEXT, created_at TEXT NOT NULL, FOREIGN KEY(bug_id) REFERENCES bugs(id), FOREIGN KEY(task_id) REFERENCES tasks(id));
      CREATE TABLE IF NOT EXISTS events(id TEXT PRIMARY KEY,user_id TEXT,project_id TEXT,task_id TEXT,bug_id TEXT,type TEXT,timestamp TEXT,payload TEXT,sensitivity TEXT);
      CREATE TABLE IF NOT EXISTS worklog_events(id TEXT PRIMARY KEY,client_event_id TEXT NOT NULL UNIQUE,user_id TEXT NOT NULL,task_id TEXT NOT NULL,event_type TEXT NOT NULL,source TEXT NOT NULL,workspace_path TEXT,file_path TEXT,occurred_at TEXT NOT NULL,created_at TEXT NOT NULL,sequence INTEGER NOT NULL,payload_json TEXT NOT NULL,FOREIGN KEY(task_id) REFERENCES tasks(id));
      CREATE TABLE IF NOT EXISTS summary_drafts(id TEXT PRIMARY KEY,task_id TEXT,status TEXT,content TEXT,created_at TEXT,updated_at TEXT);
      CREATE TABLE IF NOT EXISTS knowledge_entries(id TEXT PRIMARY KEY,task_id TEXT,type TEXT,title TEXT,content TEXT,source_file TEXT);
    ''')
    # Context packages are immutable sanitized snapshots.  The repository owns
    # its additive migration so older local databases remain compatible.
    from app.ai.context.repository import ensure_schema
    ensure_schema(c)
    def add_column(table: str, column: str, declaration: str):
        columns = {row['name'] for row in c.execute(f'PRAGMA table_info({table})')}
        if column not in columns: c.execute(f'ALTER TABLE {table} ADD COLUMN {column} {declaration}')
    add_column('projects', 'workspace_path', 'TEXT')
    add_column('projects', 'normalized_name', 'TEXT')
    add_column('projects', 'workspace_key', 'TEXT')
    add_column('projects', 'created_at', 'TEXT')
    add_column('projects', 'updated_at', 'TEXT')
    add_column('projects', 'workspace_identity_key', 'TEXT')
    add_column('projects', 'workspace_identity_version', 'INTEGER')
    add_column('projects', 'workspace_kind', 'TEXT')
    add_column('projects', 'canonical_workspace_uri', 'TEXT')
    add_column('projects', 'last_seen_at', 'TEXT')
    add_column('tasks', 'duration_seconds', 'INTEGER')
    add_column('tasks', 'created_at', 'TEXT')
    add_column('tasks', 'updated_at', 'TEXT')
    # Stage 5 is deliberately additive: older databases retain every row.
    for name, declaration in (
        ('project_id', 'TEXT'), ('description', 'TEXT'), ('severity', 'TEXT'),
        ('category', 'TEXT'), ('source', 'TEXT'), ('external_reference', 'TEXT'),
        ('tags_json', "TEXT NOT NULL DEFAULT '[]'"), ('updated_at', 'TEXT'),
        ('activated_at', 'TEXT'), ('paused_at', 'TEXT'), ('reopened_at', 'TEXT'),
        ('active_started_at', 'TEXT'), ('total_active_seconds', 'INTEGER NOT NULL DEFAULT 0'),
    ): add_column('bugs', name, declaration)
    add_column('worklog_events', 'bug_id', 'TEXT')
    timestamp = now()
    c.execute("UPDATE projects SET normalized_name=lower(trim(name)) WHERE normalized_name IS NULL")
    c.execute("UPDATE projects SET workspace_key=lower(trim(workspace_path)) WHERE workspace_key IS NULL")
    c.execute("UPDATE projects SET created_at=COALESCE(created_at, ?), updated_at=COALESCE(updated_at, created_at, ?) ", (timestamp, timestamp))
    c.execute("UPDATE tasks SET created_at=COALESCE(created_at, started_at, ?), updated_at=COALESCE(updated_at, ended_at, started_at, ?) ", (timestamp, timestamp))
    c.execute("UPDATE bugs SET project_id=(SELECT project_id FROM tasks WHERE tasks.id=bugs.task_id) WHERE project_id IS NULL")
    c.execute("UPDATE bugs SET severity=COALESCE(severity, 'medium'), tags_json=COALESCE(tags_json, '[]'), updated_at=COALESCE(updated_at, created_at, ?), total_active_seconds=COALESCE(total_active_seconds, 0)", (timestamp,))
    # Older releases allowed multiple active bugs. Preserve them while repairing the
    # invariant before creating the partial unique index: newest remains active,
    # every other prior active bug becomes paused.
    duplicate_active_tasks = c.execute("SELECT task_id FROM bugs WHERE status='active' GROUP BY task_id HAVING COUNT(*) > 1").fetchall()
    for item in duplicate_active_tasks:
        rows = c.execute("SELECT id FROM bugs WHERE task_id=? AND status='active' ORDER BY created_at DESC, id DESC", (item['task_id'],)).fetchall()
        for old in rows[1:]:
            c.execute("UPDATE bugs SET status='paused', paused_at=?, updated_at=?, active_started_at=NULL WHERE id=?", (timestamp, timestamp, old['id']))
    c.execute('CREATE UNIQUE INDEX IF NOT EXISTS ux_projects_user_name_workspace ON projects(user_id, normalized_name, COALESCE(workspace_key, \'\'))')
    c.execute('CREATE UNIQUE INDEX IF NOT EXISTS ux_projects_workspace_identity ON projects(user_id, workspace_identity_key) WHERE workspace_identity_key IS NOT NULL')
    c.execute('CREATE UNIQUE INDEX IF NOT EXISTS ux_tasks_one_active ON tasks(user_id) WHERE status=\'active\'')
    c.execute('CREATE INDEX IF NOT EXISTS ix_worklog_events_task_sequence ON worklog_events(task_id, sequence, occurred_at, id)')
    c.execute('CREATE INDEX IF NOT EXISTS ix_worklog_events_bug ON worklog_events(task_id, bug_id, sequence)')
    c.execute('CREATE INDEX IF NOT EXISTS ix_bugs_task ON bugs(task_id, status, updated_at)')
    c.execute("CREATE UNIQUE INDEX IF NOT EXISTS ux_bugs_one_active ON bugs(task_id) WHERE status='active'")
    c.execute('CREATE INDEX IF NOT EXISTS ix_bug_notes_bug ON bug_notes(bug_id, created_at, id)')
    c.execute('CREATE INDEX IF NOT EXISTS ix_bug_resolutions_bug ON bug_resolutions(bug_id, created_at, id)')
    c.execute('INSERT OR IGNORE INTO users VALUES (?,?)', ('local-user','Local User')); return c
def auth(authorization: Optional[str]):
    if authorization != f'Bearer {TOKEN}': raise HTTPException(401, 'Invalid session token')

def request_server_shutdown() -> None:
    callback = getattr(app.state, 'shutdown_callback', None)
    if callback:
        callback()

@app.post('/runtime/shutdown')
async def runtime_shutdown(request: Dict[str, Any], authorization: Optional[str] = Header(None)):
    auth(authorization)
    if request.get('generation') != BACKEND_GENERATION:
        raise HTTPException(409, 'Backend generation does not match')
    # The callback only flips Uvicorn's exit flag.  It never persists any
    # runtime-token or shutdown information to the business database.
    asyncio.get_running_loop().call_soon(request_server_shutdown)
    return {'accepted': True, 'generation': BACKEND_GENERATION}
class ProjectIn(BaseModel):
    name: str = Field(min_length=1)
    workspace_path: Optional[str] = None
    workspace_identity_key: Optional[str] = None
    workspace_identity_version: Optional[int] = None
    workspace_kind: Optional[str] = None
    canonical_workspace_uri: Optional[str] = None
class TaskIn(BaseModel): name: str; project: Optional[str] = None; project_id: Optional[str] = None; description: str = ''; requirement_id: str = ''; tags: List[str] = []
class BugIn(BaseModel):
    title: str = Field(min_length=1, max_length=500)
    description: Optional[str] = Field(None, max_length=4000)
    severity: str = 'medium'
    category: Optional[str] = Field(None, max_length=200)
    source: Optional[str] = Field(None, max_length=200)
    external_reference: Optional[str] = Field(None, max_length=500)
    tags: List[str] = []
    activate_immediately: bool = False
    @validator('title')
    def title_not_blank(cls, value):
        if not value.strip(): raise ValueError('title must not be blank')
        return value.strip()
    @validator('severity')
    def valid_severity(cls, value):
        if value not in {'low','medium','high','critical'}: raise ValueError('severity must be low, medium, high, or critical')
        return value
class BugNoteIn(BaseModel):
    client_note_id: str = Field(min_length=1, max_length=200)
    text: str = Field(min_length=1, max_length=4000)
    @validator('text')
    def note_not_blank(cls, value):
        if not value.strip(): raise ValueError('text must not be blank')
        return value.strip()
class BugResolutionIn(BaseModel):
    resolution_summary: str = Field(min_length=1, max_length=4000)
    root_cause: Optional[str] = Field(None, max_length=4000)
    verification: Optional[str] = Field(None, max_length=4000)
    @validator('resolution_summary')
    def summary_not_blank(cls, value):
        if not value.strip(): raise ValueError('resolution_summary must not be blank')
        return value.strip()
class EventIn(BaseModel): userId: str='local-user'; projectId: str; taskId: str; bugId: Optional[str]=None; source: str='vscode'; type: str; timestamp: str; payload: Dict[str,Any]={}; sensitivity: str='normal'
EVENT_TYPES = {'file_changed','file_saved','diagnostics_changed','vscode_task_started','vscode_task_process_started','vscode_task_process_ended','vscode_task_ended','debug_session_started','debug_session_terminated','debug_active_session_changed','manual_note'}
class CapturedEvent(BaseModel):
    client_event_id: str = Field(min_length=1, max_length=200)
    event_type: str
    source: str = 'vscode'
    workspace_path: Optional[str] = None
    file_path: Optional[str] = None
    bug_id: Optional[str] = Field(None, alias='bugId')
    class Config:
        # Accept both wire forms: existing clients send bugId while the
        # buffered extension contract deliberately uses snake_case bug_id.
        populate_by_name = True
    occurred_at: str
    payload: Dict[str, Any] = {}
    @validator('occurred_at')
    def valid_time(cls, value):
        try:
            normalized = re.sub(r'(\.\d{6})\d+(?=(Z|[+-]\d\d:\d\d)$)', r'\1', value).replace('Z', '+00:00')
            datetime.fromisoformat(normalized)
        except ValueError: raise ValueError('occurred_at must be ISO 8601')
        return value
    @validator('event_type')
    def valid_type(cls, value):
        if value not in EVENT_TYPES: raise ValueError('unsupported event_type')
        return value
class EventBatch(BaseModel): events: List[CapturedEvent]
class SummaryIn(BaseModel): content: Dict[str,Any]
class SessionIn(BaseModel): token: str; model: Optional[str]=None; base_url: Optional[str]=None; api_key: Optional[str]=None

@app.get('/health')
def health(): return {'status':'ok','service':'local-server'}
@app.post('/session/initialize')
def initialize(x: SessionIn):
    global TOKEN; TOKEN=x.token; return {'ok':True}
@app.get('/projects')
def projects(authorization: Optional[str]=Header(None)):
    auth(authorization); return [dict(r) for r in db().execute('SELECT * FROM projects WHERE user_id=? ORDER BY updated_at DESC, name',('local-user',))]
@app.post('/projects')
def create_project(x: ProjectIn, authorization: Optional[str]=Header(None)):
    auth(authorization); name=x.name.strip()
    if not name: raise HTTPException(422, 'Project name is required')
    workspace = x.workspace_path.strip() if x.workspace_path else None
    workspace_key = normalize_workspace(workspace)
    identity_key = x.workspace_identity_key.strip() if x.workspace_identity_key else None
    normalized = name.casefold(); c=db(); existing = c.execute('SELECT * FROM projects WHERE user_id=? AND workspace_identity_key=?', ('local-user', identity_key)).fetchone() if identity_key else None
    if not existing: existing=c.execute('SELECT * FROM projects WHERE user_id=? AND normalized_name=? AND COALESCE(workspace_key, \'\')=?', ('local-user', normalized, workspace_key)).fetchone()
    if existing: return dict(existing)
    pid=str(uuid.uuid4()); slug=re.sub(r'[^a-z0-9]+','-',name.lower()).strip('-') or pid[:8]
    if c.execute('SELECT 1 FROM projects WHERE slug=?', (slug,)).fetchone(): slug=f'{slug}-{pid[:8]}'
    timestamp=now()
    try: c.execute('INSERT INTO projects(id,user_id,name,slug,workspace_path,workspace_key,normalized_name,workspace_identity_key,workspace_identity_version,workspace_kind,canonical_workspace_uri,last_seen_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',(pid,'local-user',name,slug,workspace,workspace_key,normalized,identity_key,x.workspace_identity_version,x.workspace_kind,x.canonical_workspace_uri,timestamp,timestamp,timestamp))
    except sqlite3.IntegrityError:
        existing=c.execute('SELECT * FROM projects WHERE user_id=? AND workspace_identity_key=?', ('local-user', identity_key)).fetchone()
        if existing: return dict(existing)
        raise HTTPException(409, 'Project already exists')
    return dict(c.execute('SELECT * FROM projects WHERE id=?',(pid,)).fetchone())

@app.post('/projects/resolve')
def resolve_project(x: ProjectIn, authorization: Optional[str]=Header(None)):
    """Atomic identity-first project resolution; compatible with legacy path rows."""
    auth(authorization)
    if not x.workspace_identity_key: raise HTTPException(422, 'workspace_identity_key is required')
    c=db(); c.execute('BEGIN IMMEDIATE')
    try:
        row=c.execute('SELECT * FROM projects WHERE user_id=? AND workspace_identity_key=?', ('local-user', x.workspace_identity_key)).fetchone()
        matched='workspace_identity'
        if not row and x.workspace_path:
            row=c.execute('SELECT * FROM projects WHERE user_id=? AND workspace_key=?', ('local-user', normalize_workspace(x.workspace_path))).fetchone()
            if row:
                c.execute('UPDATE projects SET workspace_identity_key=?,workspace_identity_version=?,workspace_kind=?,canonical_workspace_uri=?,last_seen_at=?,updated_at=? WHERE id=?', (x.workspace_identity_key,x.workspace_identity_version,x.workspace_kind,x.canonical_workspace_uri,now(),now(),row['id']))
                matched='legacy_workspace_path'
        if not row:
            name=x.name.strip(); normalized=name.casefold(); workspace=x.workspace_path.strip() if x.workspace_path else None; workspace_key=normalize_workspace(workspace)
            pid=str(uuid.uuid4()); slug=re.sub(r'[^a-z0-9]+','-',name.lower()).strip('-') or pid[:8]
            if c.execute('SELECT 1 FROM projects WHERE slug=?',(slug,)).fetchone(): slug=f'{slug}-{pid[:8]}'
            stamp=now()
            c.execute('INSERT INTO projects(id,user_id,name,slug,workspace_path,workspace_key,normalized_name,workspace_identity_key,workspace_identity_version,workspace_kind,canonical_workspace_uri,last_seen_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',(pid,'local-user',name,slug,workspace,workspace_key,normalized,x.workspace_identity_key,x.workspace_identity_version,x.workspace_kind,x.canonical_workspace_uri,stamp,stamp,stamp))
            c.commit(); return {'project': dict(c.execute('SELECT * FROM projects WHERE id=?',(pid,)).fetchone()), 'created': True, 'matched_by': 'created'}
        c.execute('UPDATE projects SET last_seen_at=?,updated_at=? WHERE id=?',(now(),now(),row['id'])); c.commit()
        return {'project': dict(c.execute('SELECT * FROM projects WHERE id=?',(row['id'],)).fetchone()), 'created': False, 'matched_by': matched}
    except Exception:
        c.rollback(); raise

def task_output(row: sqlite3.Row) -> dict:
    out=dict(row); out['tags']=json.loads(out.get('tags') or '[]'); return out

@app.get('/tasks/active')
def active_task(authorization: Optional[str]=Header(None)):
    auth(authorization); c=db(); row=c.execute("SELECT * FROM tasks WHERE user_id=? AND status='active' LIMIT 1", ('local-user',)).fetchone(); return {'task': task_output(row) if row else None}
@app.post('/tasks')
def create_task(x: TaskIn, authorization: Optional[str]=Header(None)):
    auth(authorization); name=x.name.strip();
    if not name: raise HTTPException(422, 'Task name is required')
    c=db(); c.execute('BEGIN IMMEDIATE')
    try:
        active=c.execute("SELECT id,name FROM tasks WHERE user_id=? AND status='active' LIMIT 1", ('local-user',)).fetchone()
        if active: raise HTTPException(409, f"已有活动任务：{active['name']} ({active['id']})")
        row=c.execute('SELECT * FROM projects WHERE id=? AND user_id=?', (x.project_id,'local-user')).fetchone() if x.project_id else None
        if not row and x.project: row=c.execute('SELECT * FROM projects WHERE name=? AND user_id=? ORDER BY updated_at DESC LIMIT 1',(x.project.strip(),'local-user')).fetchone()
        if not row and x.project:
            project_name=x.project.strip(); normalized=project_name.casefold(); timestamp=now(); pid=str(uuid.uuid4()); slug=re.sub(r'[^a-z0-9]+','-',project_name.lower()).strip('-') or pid[:8]
            if c.execute('SELECT 1 FROM projects WHERE slug=?', (slug,)).fetchone(): slug=f'{slug}-{pid[:8]}'
            c.execute('INSERT OR IGNORE INTO projects(id,user_id,name,slug,workspace_path,normalized_name,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)',(pid,'local-user',project_name,slug,None,normalized,timestamp,timestamp))
            row=c.execute('SELECT * FROM projects WHERE user_id=? AND normalized_name=? AND COALESCE(workspace_path, \'\')=\'\'',('local-user',normalized)).fetchone()
        if not row: raise HTTPException(404, 'Project not found')
        tags=[]
        for tag in x.tags:
            value=tag.strip()
            if value and value.casefold() not in {item.casefold() for item in tags}: tags.append(value)
        started=now(); tid=str(uuid.uuid4()); timestamp=started
        c.execute('INSERT INTO tasks(id,user_id,project_id,name,description,requirement_id,tags,status,started_at,ended_at,duration_seconds,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',(tid,'local-user',row['id'],name,x.description.strip(),x.requirement_id.strip(),json.dumps(tags,ensure_ascii=False),'active',started,None,None,timestamp,timestamp)); c.commit()
    except Exception:
        c.rollback(); raise
    return task(tid,authorization)
@app.get('/tasks')
def list_tasks(status: Optional[str]=None, authorization: Optional[str]=Header(None)):
    """Compatibility list endpoint; Context UI uses status=completed."""
    auth(authorization)
    c=db(); params=['local-user']; where='user_id=?'
    if status:
        where += ' AND status=?'; params.append(status)
    return [task_output(row) for row in c.execute(f'SELECT * FROM tasks WHERE {where} ORDER BY COALESCE(ended_at,started_at) DESC,id DESC', params)]

def context_http_error(error):
    raise HTTPException(400 if error.code not in {'task_not_found','context_not_found'} else 404, {'code': error.code, 'message': error.message})

@app.post('/tasks/{task_id}/ai/context-packages')
def build_context_package(task_id: str, request: Dict[str, Any], authorization: Optional[str]=Header(None)):
    auth(authorization)
    from app.ai.context.service import ContextError, build_package
    try:
        request = ContextBuildRequest.model_validate(request) if hasattr(ContextBuildRequest, 'model_validate') else ContextBuildRequest.parse_obj(request)
    except ValidationError:
        raise HTTPException(400, {'code':'invalid_build_config','message':'Build configuration is invalid'})
    c=db(); c.execute('BEGIN IMMEDIATE')
    try:
        result=build_package(c,task_id,request.config,request.idempotency_key,now()); c.commit(); return result
    except ContextError as error:
        c.rollback(); context_http_error(error)
    except Exception:
        c.rollback(); raise

@app.get('/tasks/{task_id}/ai/context-packages')
def list_context_packages(task_id: str, authorization: Optional[str]=Header(None)):
    auth(authorization)
    from app.ai.context import repository
    c=db(); repository.ensure_schema(c)
    if not c.execute('SELECT 1 FROM tasks WHERE id=? AND user_id=?',(task_id,'local-user')).fetchone():
        raise HTTPException(404, {'code':'task_not_found','message':'Task was not found'})
    return {'items':repository.list_for_task(c,task_id)}

@app.get('/ai/context-packages/{context_id}')
def get_context_package(context_id: str, authorization: Optional[str]=Header(None)):
    auth(authorization)
    from app.ai.context import repository
    package=repository.get(db(),context_id)
    if not package: raise HTTPException(404, {'code':'context_not_found','message':'Context package was not found'})
    return package

@app.post('/ai/context-packages/{context_id}/ready')
def ready_context_package(context_id: str, authorization: Optional[str]=Header(None)):
    auth(authorization)
    from app.ai.context.service import ContextError, ready_package
    c=db(); c.execute('BEGIN IMMEDIATE')
    try:
        result=ready_package(c,context_id,now()); c.commit(); return result
    except ContextError as error:
        c.rollback(); context_http_error(error)
    except Exception:
        c.rollback(); raise
@app.get('/tasks/{task_id}')
def task(task_id: str, authorization: Optional[str]=Header(None)):
    auth(authorization); r=db().execute('SELECT * FROM tasks WHERE id=? AND user_id=?',(task_id,'local-user')).fetchone();
    if not r: raise HTTPException(404,'Task not found')
    return task_output(r)
@app.post('/tasks/{task_id}/end')
def end_task(task_id: str, authorization: Optional[str]=Header(None)):
    auth(authorization); c=db(); c.execute('BEGIN IMMEDIATE')
    try:
        r=c.execute('SELECT * FROM tasks WHERE id=? AND user_id=?',(task_id,'local-user')).fetchone()
        if not r: raise HTTPException(404,'Task not found')
        if r['status'] != 'active': raise HTTPException(409, f"任务已结束：{r['name']} ({task_id})")
        ended=now(); duration=max(0, int((datetime.fromisoformat(ended)-datetime.fromisoformat(r['started_at'])).total_seconds()))
        # Pause before completing in the same transaction; a completed task can never retain an active bug.
        active_bug = c.execute("SELECT * FROM bugs WHERE task_id=? AND status='active'", (task_id,)).fetchone()
        if active_bug:
            elapsed = active_seconds(active_bug, ended)
            c.execute("UPDATE bugs SET status='paused', paused_at=?, updated_at=?, active_started_at=NULL, total_active_seconds=? WHERE id=?", (ended, ended, elapsed, active_bug['id']))
        c.execute('UPDATE tasks SET status=?,ended_at=?,duration_seconds=?,updated_at=? WHERE id=?',('completed',ended,duration,ended,task_id)); c.commit()
    except Exception:
        c.rollback(); raise
    return task(task_id,authorization)
def event_task(task_id: str, c: sqlite3.Connection):
    row = c.execute('SELECT * FROM tasks WHERE id=? AND user_id=?', (task_id, 'local-user')).fetchone()
    if not row: raise HTTPException(404, 'Task not found')
    if row['status'] != 'active': raise HTTPException(409, '任务已结束，不能写入事件')
    return row

def event_output(row: sqlite3.Row) -> dict:
    out = dict(row); out['payload'] = json.loads(out.pop('payload_json')); out['clientEventId'] = out.pop('client_event_id'); out['eventType'] = out.pop('event_type'); out['occurredAt'] = out.pop('occurred_at'); out['createdAt'] = out.pop('created_at'); out['workspacePath'] = out.pop('workspace_path'); out['filePath'] = out.pop('file_path'); out['bugId'] = out.get('bug_id'); out['sequence'] = int(out['sequence']); return out

@app.post('/tasks/{task_id}/events/batch')
def batch_events(task_id: str, batch: EventBatch, authorization: Optional[str]=Header(None)):
    auth(authorization)
    if not batch.events: raise HTTPException(400, 'events must not be empty')
    if len(batch.events) > 100: raise HTTPException(400, 'maximum 100 events per batch')
    c = db(); event_task(task_id, c); inserted = 0; duplicates = 0; ids = []
    c.execute('BEGIN IMMEDIATE')
    try:
        for event in batch.events:
            payload = filter_sensitive(event.payload)
            payload_json = json.dumps(payload, ensure_ascii=False, separators=(',', ':'))
            if len(payload_json.encode('utf-8')) > 262144: raise HTTPException(400, 'event payload exceeds 256 KB')
            existing = c.execute('SELECT id FROM worklog_events WHERE client_event_id=?', (event.client_event_id,)).fetchone()
            if existing: duplicates += 1; ids.append(existing['id']); continue
            if getattr(event, 'bug_id', None):
                bug_row = c.execute('SELECT id FROM bugs WHERE id=? AND task_id=? AND user_id=?', (event.bug_id, task_id, 'local-user')).fetchone()
                if not bug_row: raise HTTPException(422, 'bug_id must belong to this task')
            sequence = c.execute('SELECT COALESCE(MAX(sequence),0)+1 FROM worklog_events WHERE task_id=?', (task_id,)).fetchone()[0]
            eid = str(uuid.uuid4()); created = now()
            c.execute('INSERT INTO worklog_events(id,client_event_id,user_id,task_id,event_type,source,workspace_path,file_path,occurred_at,created_at,sequence,payload_json,bug_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)', (eid,event.client_event_id,'local-user',task_id,event.event_type,event.source,event.workspace_path,event.file_path,event.occurred_at,created,sequence,payload_json,getattr(event, 'bug_id', None)))
            inserted += 1; ids.append(eid)
        c.commit()
    except Exception:
        c.rollback(); raise
    return {'inserted': inserted, 'duplicates': duplicates, 'event_ids': ids}

@app.get('/tasks/{task_id}/events')
def captured_events(task_id: str, limit: int=100, offset: int=0, event_type: Optional[str]=None, bug_id: Optional[str]=None, authorization: Optional[str]=Header(None)):
    auth(authorization)
    if limit < 1 or limit > 500: raise HTTPException(400, 'limit must be between 1 and 500')
    if offset < 0: raise HTTPException(400, 'offset must be non-negative')
    c=db(); row=c.execute('SELECT id FROM tasks WHERE id=? AND user_id=?',(task_id,'local-user')).fetchone()
    if not row: raise HTTPException(404,'Task not found')
    where='task_id=?'; params=[task_id]
    if event_type: where += ' AND event_type=?'; params.append(event_type)
    if bug_id:
        where += ' AND bug_id=?'; params.append(bug_id)
    total=c.execute(f'SELECT COUNT(*) FROM worklog_events WHERE {where}',params).fetchone()[0]
    rows=c.execute(f'SELECT * FROM worklog_events WHERE {where} ORDER BY sequence ASC, occurred_at ASC, id ASC LIMIT ? OFFSET ?',params+[limit,offset]).fetchall()
    if not rows and total == 0:
        legacy = c.execute('SELECT * FROM events WHERE task_id=? ORDER BY timestamp', (task_id,)).fetchall()
        if legacy:
            return [dict(dict(r), payload=json.loads(r['payload'])) for r in legacy]
    return {'items':[event_output(r) for r in rows], 'total':total, 'limit':limit, 'offset':offset}

@app.get('/tasks/{task_id}/events/summary')
def captured_event_summary(task_id: str, authorization: Optional[str]=Header(None)):
    auth(authorization); c=db()
    if not c.execute('SELECT id FROM tasks WHERE id=? AND user_id=?',(task_id,'local-user')).fetchone(): raise HTTPException(404,'Task not found')
    rows=c.execute('SELECT event_type, COUNT(*) AS count, MAX(occurred_at) AS latest FROM worklog_events WHERE task_id=? GROUP BY event_type',(task_id,)).fetchall()
    latest=c.execute('SELECT occurred_at FROM worklog_events WHERE task_id=? ORDER BY sequence DESC LIMIT 1',(task_id,)).fetchone()
    return {'total':sum(r['count'] for r in rows), 'by_type':{r['event_type']:r['count'] for r in rows}, 'latest_event_at':latest['occurred_at'] if latest else None}

@app.get('/tasks/{task_id}/events')
def events(task_id: str, authorization: Optional[str]=Header(None)):
    auth(authorization); return [dict(dict(r), payload=json.loads(r['payload'])) for r in db().execute('SELECT * FROM events WHERE task_id=? ORDER BY timestamp',(task_id,))]
@app.post('/events')
def add_event(x: EventIn, authorization: Optional[str]=Header(None)):
    auth(authorization); c=db(); task_row=event_task(x.taskId,c)
    if task_row['project_id'] != x.projectId: raise HTTPException(422, 'projectId must match task project')
    if x.bugId and not c.execute('SELECT 1 FROM bugs WHERE id=? AND task_id=? AND user_id=?',(x.bugId,x.taskId,'local-user')).fetchone(): raise HTTPException(422, 'bugId must belong to this task')
    eid=x.__dict__.get('id') or str(uuid.uuid4()); c.execute('INSERT INTO events VALUES (?,?,?,?,?,?,?,?,?)',(eid,x.userId,x.projectId,x.taskId,x.bugId,x.type,x.timestamp,json.dumps(filter_sensitive(x.payload),ensure_ascii=False),x.sensitivity)); c.commit(); return {'id':eid}
def active_seconds(row: sqlite3.Row, timestamp: str) -> int:
    total = int(row['total_active_seconds'] or 0)
    if row['active_started_at']:
        total += max(0, int((datetime.fromisoformat(timestamp) - datetime.fromisoformat(row['active_started_at'])).total_seconds()))
    return total

def bug_output(row: sqlite3.Row) -> dict:
    out = dict(row)
    out['tags'] = json.loads(out.pop('tags_json') or '[]')
    out['total_active_seconds'] = int(out.get('total_active_seconds') or 0)
    return out

def task_for_bug(c: sqlite3.Connection, task_id: str, writable: bool = False) -> sqlite3.Row:
    task_row = c.execute('SELECT * FROM tasks WHERE id=? AND user_id=?', (task_id, 'local-user')).fetchone()
    if not task_row: raise HTTPException(404, 'Task not found')
    if writable and task_row['status'] != 'active': raise HTTPException(409, 'Cannot modify bugs for a completed task')
    return task_row

def owned_bug(c: sqlite3.Connection, task_id: str, bug_id: str) -> sqlite3.Row:
    row = c.execute('SELECT * FROM bugs WHERE id=? AND task_id=? AND user_id=?', (bug_id, task_id, 'local-user')).fetchone()
    if not row: raise HTTPException(404, 'Bug not found')
    return row

def normalized_tags(tags: List[str]) -> List[str]:
    result: List[str] = []
    for tag in tags:
        value = tag.strip()
        if value and value.casefold() not in {item.casefold() for item in result}: result.append(value)
    return result

@app.post('/tasks/{task_id}/bugs')
def create_bug(task_id: str, x: BugIn, authorization: Optional[str]=Header(None)):
    auth(authorization); c=db(); c.execute('BEGIN IMMEDIATE')
    try:
        task_row = task_for_bug(c, task_id, writable=True); timestamp=now(); bid=str(uuid.uuid4())
        status = 'open'; active_started_at = None; activated_at = None
        if x.activate_immediately:
            old = c.execute("SELECT * FROM bugs WHERE task_id=? AND status='active'", (task_id,)).fetchone()
            if old:
                c.execute("UPDATE bugs SET status='paused',paused_at=?,updated_at=?,active_started_at=NULL,total_active_seconds=? WHERE id=?", (timestamp,timestamp,active_seconds(old,timestamp),old['id']))
            status='active'; active_started_at=timestamp; activated_at=timestamp
        c.execute('''INSERT INTO bugs(id,user_id,project_id,task_id,title,description,severity,category,source,external_reference,tags_json,status,created_at,updated_at,activated_at,active_started_at,total_active_seconds)
                     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)''',
                  (bid,'local-user',task_row['project_id'],task_id,x.title,x.description,x.severity,x.category,x.source,x.external_reference,json.dumps(normalized_tags(x.tags),ensure_ascii=False),status,timestamp,timestamp,activated_at,active_started_at,0))
        c.commit()
    except Exception:
        c.rollback(); raise
    return bug_output(owned_bug(db(), task_id, bid))

@app.get('/tasks/{task_id}/bugs')
def bugs(task_id: str, status: Optional[str]=None, severity: Optional[str]=None, limit: int=100, offset: int=0, authorization: Optional[str]=Header(None)):
    auth(authorization)
    if status and status not in {'open','active','paused','resolved'}: raise HTTPException(422, 'Invalid bug status')
    if severity and severity not in {'low','medium','high','critical'}: raise HTTPException(422, 'Invalid bug severity')
    if not 1 <= limit <= 500 or offset < 0: raise HTTPException(400, 'Invalid limit or offset')
    c=db(); task_for_bug(c, task_id); where='task_id=? AND user_id=?'; params=[task_id,'local-user']
    if status: where += ' AND status=?'; params.append(status)
    if severity: where += ' AND severity=?'; params.append(severity)
    total=c.execute(f'SELECT COUNT(*) FROM bugs WHERE {where}',params).fetchone()[0]
    order="CASE status WHEN 'active' THEN 0 WHEN 'open' THEN 1 WHEN 'paused' THEN 2 ELSE 3 END, updated_at DESC, id ASC"
    rows=c.execute(f'SELECT * FROM bugs WHERE {where} ORDER BY {order} LIMIT ? OFFSET ?',params+[limit,offset]).fetchall()
    return {'items':[bug_output(r) for r in rows], 'total':total, 'limit':limit, 'offset':offset}

@app.get('/tasks/{task_id}/bugs/current')
def current_bug(task_id: str, authorization: Optional[str]=Header(None)):
    auth(authorization); c=db(); task_for_bug(c, task_id)
    row=c.execute("SELECT * FROM bugs WHERE task_id=? AND user_id=? AND status='active'", (task_id,'local-user')).fetchone()
    return {'bug':bug_output(row) if row else None}

@app.get('/tasks/{task_id}/bugs/{bug_id}')
def get_bug(task_id: str, bug_id: str, authorization: Optional[str]=Header(None)):
    auth(authorization); return bug_output(owned_bug(db(), task_id, bug_id))

@app.post('/tasks/{task_id}/bugs/{bug_id}/activate')
def activate_bug(task_id: str, bug_id: str, authorization: Optional[str]=Header(None)):
    auth(authorization); c=db(); c.execute('BEGIN IMMEDIATE')
    try:
        task_for_bug(c,task_id,True); target=owned_bug(c,task_id,bug_id)
        if target['status'] == 'resolved': raise HTTPException(409, 'Bug is resolved; reopen it first')
        if target['status'] == 'active': raise HTTPException(409, 'Bug is already active')
        timestamp=now(); old=c.execute("SELECT * FROM bugs WHERE task_id=? AND status='active'",(task_id,)).fetchone()
        paused=None
        if old:
            c.execute("UPDATE bugs SET status='paused',paused_at=?,updated_at=?,active_started_at=NULL,total_active_seconds=? WHERE id=?",(timestamp,timestamp,active_seconds(old,timestamp),old['id']))
            paused=bug_output(owned_bug(c,task_id,old['id']))
        c.execute("UPDATE bugs SET status='active',activated_at=?,updated_at=?,active_started_at=? WHERE id=?",(timestamp,timestamp,timestamp,bug_id)); c.commit()
    except Exception:
        c.rollback(); raise
    return {'active_bug':bug_output(owned_bug(db(),task_id,bug_id)), 'paused_bug':paused}

@app.post('/tasks/{task_id}/bugs/{bug_id}/pause')
def pause_bug(task_id: str, bug_id: str, authorization: Optional[str]=Header(None)):
    auth(authorization); c=db(); c.execute('BEGIN IMMEDIATE')
    try:
        task_for_bug(c,task_id,True); row=owned_bug(c,task_id,bug_id)
        if row['status'] != 'active': raise HTTPException(409, 'Only an active bug can be paused')
        timestamp=now(); c.execute("UPDATE bugs SET status='paused',paused_at=?,updated_at=?,active_started_at=NULL,total_active_seconds=? WHERE id=?",(timestamp,timestamp,active_seconds(row,timestamp),bug_id)); c.commit()
    except Exception: c.rollback(); raise
    return bug_output(owned_bug(db(),task_id,bug_id))

@app.post('/tasks/{task_id}/bugs/{bug_id}/resolve')
def resolve_bug_task(task_id: str, bug_id: str, x: BugResolutionIn, authorization: Optional[str]=Header(None)):
    auth(authorization); c=db(); c.execute('BEGIN IMMEDIATE')
    try:
        task_for_bug(c,task_id,True); row=owned_bug(c,task_id,bug_id)
        if row['status'] == 'resolved': raise HTTPException(409, 'Bug is already resolved')
        timestamp=now(); total=active_seconds(row,timestamp) if row['status']=='active' else int(row['total_active_seconds'] or 0)
        c.execute("UPDATE bugs SET status='resolved',resolved_at=?,updated_at=?,active_started_at=NULL,total_active_seconds=? WHERE id=?",(timestamp,timestamp,total,bug_id))
        c.execute('INSERT INTO bug_resolutions VALUES (?,?,?,?,?,?,?,?)',(str(uuid.uuid4()),'local-user',task_id,bug_id,x.resolution_summary,x.root_cause,x.verification,timestamp)); c.commit()
    except Exception: c.rollback(); raise
    return bug_output(owned_bug(db(),task_id,bug_id))

@app.post('/tasks/{task_id}/bugs/{bug_id}/reopen')
def reopen_bug(task_id: str, bug_id: str, authorization: Optional[str]=Header(None)):
    auth(authorization); c=db(); c.execute('BEGIN IMMEDIATE')
    try:
        task_for_bug(c,task_id,True); row=owned_bug(c,task_id,bug_id)
        if row['status'] != 'resolved': raise HTTPException(409, 'Only a resolved bug can be reopened')
        timestamp=now(); c.execute("UPDATE bugs SET status='open',reopened_at=?,updated_at=? WHERE id=?",(timestamp,timestamp,bug_id)); c.commit()
    except Exception: c.rollback(); raise
    return bug_output(owned_bug(db(),task_id,bug_id))

@app.get('/tasks/{task_id}/bugs/{bug_id}/notes')
def bug_notes(task_id: str, bug_id: str, authorization: Optional[str]=Header(None)):
    auth(authorization); c=db(); owned_bug(c,task_id,bug_id)
    return {'items':[dict(r) for r in c.execute('SELECT * FROM bug_notes WHERE bug_id=? AND task_id=? AND user_id=? ORDER BY created_at,id',(bug_id,task_id,'local-user'))]}

@app.post('/tasks/{task_id}/bugs/{bug_id}/notes')
def add_bug_note(task_id: str, bug_id: str, x: BugNoteIn, authorization: Optional[str]=Header(None)):
    auth(authorization); c=db(); c.execute('BEGIN IMMEDIATE')
    try:
        task_for_bug(c,task_id,True); owned_bug(c,task_id,bug_id)
        existing=c.execute('SELECT * FROM bug_notes WHERE client_note_id=?',(x.client_note_id,)).fetchone()
        if existing:
            if existing['bug_id'] != bug_id or existing['task_id'] != task_id: raise HTTPException(409, 'client_note_id already belongs to another bug')
            c.commit(); return dict(existing)
        nid=str(uuid.uuid4()); timestamp=now(); c.execute('INSERT INTO bug_notes VALUES (?,?,?,?,?,?,?)',(nid,x.client_note_id,'local-user',task_id,bug_id,x.text,timestamp)); c.commit()
    except Exception: c.rollback(); raise
    return dict(db().execute('SELECT * FROM bug_notes WHERE id=?',(nid,)).fetchone())

@app.get('/tasks/{task_id}/bugs/{bug_id}/resolutions')
def bug_resolutions(task_id: str, bug_id: str, authorization: Optional[str]=Header(None)):
    auth(authorization); c=db(); owned_bug(c,task_id,bug_id)
    return {'items':[dict(r) for r in c.execute('SELECT * FROM bug_resolutions WHERE bug_id=? AND task_id=? AND user_id=? ORDER BY created_at,id',(bug_id,task_id,'local-user'))]}

@app.get('/tasks/{task_id}/bugs/{bug_id}/events')
def bug_events(task_id: str, bug_id: str, limit: int=100, offset: int=0, event_type: Optional[str]=None, authorization: Optional[str]=Header(None)):
    auth(authorization); owned_bug(db(),task_id,bug_id)
    return captured_events(task_id,limit,offset,event_type,bug_id,authorization)

# Compatibility endpoint retained for earlier extension builds.
@app.post('/bugs/{bug_id}/resolve')
def resolve_bug_legacy(bug_id: str, x: Optional[BugResolutionIn]=None, authorization: Optional[str]=Header(None)):
    auth(authorization); row=db().execute('SELECT task_id FROM bugs WHERE id=? AND user_id=?',(bug_id,'local-user')).fetchone()
    if not row: raise HTTPException(404,'Bug not found')
    return resolve_bug_task(row['task_id'],bug_id,x or BugResolutionIn(resolution_summary='Resolved'),authorization)
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

def parent_is_alive(pid: int) -> bool:
    if pid <= 0:
        return True
    if os.name == 'nt':
        # OpenProcess(SYNCHRONIZE) plus WaitForSingleObject avoids polling and
        # is reliable for the Windows EXE produced by PyInstaller.
        handle = ctypes.windll.kernel32.OpenProcess(0x00100000, False, pid)
        if not handle:
            return False
        try:
            return ctypes.windll.kernel32.WaitForSingleObject(handle, 0) == 0x00000102
        finally:
            ctypes.windll.kernel32.CloseHandle(handle)
    try:
        os.kill(pid, 0)
        return True
    except OSError:
        return False

def start_parent_watchdog(callback) -> threading.Event:
    stopped = threading.Event()
    if PARENT_PID <= 0:
        return stopped
    def watch() -> None:
        if os.name == 'nt':
            handle = ctypes.windll.kernel32.OpenProcess(0x00100000, False, PARENT_PID)
            if handle:
                try:
                    ctypes.windll.kernel32.WaitForSingleObject(handle, 0xFFFFFFFF)
                    if not stopped.is_set(): callback()
                finally:
                    ctypes.windll.kernel32.CloseHandle(handle)
                return
        # Compatibility fallback for non-Windows or an inaccessible handle.
        while not stopped.wait(1.0):
            if not parent_is_alive(PARENT_PID):
                callback(); return
    threading.Thread(target=watch, name='parent-process-watchdog', daemon=True).start()
    return stopped

if __name__ == '__main__':
    import uvicorn
    db()
    server = uvicorn.Server(uvicorn.Config(app, host=HOST, port=PORT, log_level='warning'))
    app.state.shutdown_callback = lambda: setattr(server, 'should_exit', True)
    watchdog_stop = start_parent_watchdog(app.state.shutdown_callback)
    try:
        server.run()
    finally:
        watchdog_stop.set()
