from __future__ import annotations
import hashlib, os, re, sqlite3, tempfile, uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from app.ai.generation import repository
from app.ai.context.redaction import redact_text

class PublishingError(Exception):
    def __init__(self, code: str, message: str): self.code, self.message = code, message; super().__init__(message)
def _hash(value: str) -> str: return hashlib.sha256(value.encode('utf-8')).hexdigest()
def _safe(value: str) -> str: return re.sub(r'[^a-zA-Z0-9_-]+','-',value.strip().lower()).strip('-')[:80] or 'general'
def _write(root: Path, logical: str, content: str) -> None:
    target=(root/logical).resolve(); base=root.resolve()
    if base not in target.parents: raise PublishingError('publication_path_invalid','Publication path is invalid')
    target.parent.mkdir(parents=True,exist_ok=True); fd,temp=tempfile.mkstemp(prefix='.publish-',suffix='.tmp',dir=str(target.parent))
    try:
        with os.fdopen(fd,'w',encoding='utf-8',newline='\n') as out: out.write(content)
        os.replace(temp,target)
    except Exception:
        try: os.unlink(temp)
        except OSError: pass
        raise PublishingError('publication_write_failed','Publication file could not be written')
def _approved(c: sqlite3.Connection, task_id: str) -> dict[str,Any]:
    review=repository.current_review(c,task_id)
    if not review: raise PublishingError('approved_revision_required','Please approve a summary revision before publishing')
    revision=repository.get_revision(c,review['revision_id'])
    if not revision: raise PublishingError('approved_revision_missing','Approved revision was not found')
    return revision
def _task(c: sqlite3.Connection, task_id: str) -> dict[str,Any]:
    row=c.execute('SELECT t.*,p.slug FROM tasks t JOIN projects p ON p.id=t.project_id WHERE t.id=?',(task_id,)).fetchone()
    if not row: raise PublishingError('task_not_found','Task was not found')
    return dict(row)
def _lines(title: str, entries: list[str]) -> str: return ('\n## '+title+'\n' + ''.join('- '+entry+'\n' for entry in entries)) if entries else ''
def summary_markdown(content: dict[str,Any], name: str) -> str:
    s=content['sections']; task=s['task_summary']; out=['# '+name+'\n',task['summary'],_lines('完成结果',task['outcomes'])]
    for title,key,fields in [('代码变更','code_changes',('path','summary','impact')),('命令与结果','commands_and_results',('command','result','status')),('Bug 解决方案','bug_solutions',('bug_ref','problem','solution','verification')),('未解决问题','unresolved_issues',('issue','impact','next_step')),('待办','todos',('item','priority','rationale')),('知识候选','knowledge_candidates',('title','category','summary','why_reusable'))]:
        if s[key]:
            out.append('\n## '+title+'\n')
            for row in s[key]: out.extend(['### '+str(row[fields[0]])+'\n']+[f'- {field}: {row[field]}\n' for field in fields[1:]])
    d=s['daily_report']; out.extend(['\n## 日报\n','### '+d['title']+'\n',d['body'],_lines('亮点',d['highlights']),_lines('阻塞项',d['blockers']),_lines('下一步重点',d['next_focus'])]); return '\n'.join(out).strip()+'\n'
def daily_markdown(content: dict[str,Any], task: dict[str,Any]) -> str:
    d=content['sections']['daily_report']; return f'## {task["name"]}\n\n{d["title"]}\n\n{d["body"]}\n'+_lines('亮点',d['highlights'])+_lines('阻塞项',d['blockers'])+_lines('下一步重点',d['next_focus'])+f'<!-- worklog-task:{task["id"]} -->\n'
def _export(c:sqlite3.Connection,root:Path,task:dict[str,Any],revision:dict[str,Any],kind:str,logical:str,markdown:str,timestamp:str)->dict[str,Any]:
    digest=_hash(markdown); old=c.execute('SELECT * FROM summary_export_publications WHERE task_id=? AND revision_id=? AND kind=?',(task['id'],revision['id'],kind)).fetchone(); _write(root,logical,markdown)
    if old:
        c.execute('UPDATE summary_export_publications SET logical_path=?,content_hash=?,status=?,updated_at=? WHERE id=?',(logical,digest,'published',timestamp,old['id'])); return dict(c.execute('SELECT * FROM summary_export_publications WHERE id=?',(old['id'],)).fetchone())
    c.execute("UPDATE summary_export_publications SET status='superseded',superseded_at=?,updated_at=? WHERE task_id=? AND kind=? AND superseded_at IS NULL",(timestamp,timestamp,task['id'],kind)); ident=str(uuid.uuid4()); c.execute('INSERT INTO summary_export_publications VALUES (?,?,?,?,?,?,?,?,?,?,?)',(ident,task['id'],revision['id'],kind,logical,digest,'published',timestamp,timestamp,timestamp,None)); return dict(c.execute('SELECT * FROM summary_export_publications WHERE id=?',(ident,)).fetchone())
def export_summary(c:sqlite3.Connection,root:Path,task_id:str,timestamp:str)->dict[str,Any]:
    revision=_approved(c,task_id); task=_task(c,task_id); return _export(c,root,task,revision,'task_summary',f'projects/{_safe(task.get("slug") or "project")}/task-records/{task_id}.md',summary_markdown(revision['content'],task['name']),timestamp)
def export_daily(c:sqlite3.Connection,root:Path,task_id:str,timestamp:str)->dict[str,Any]:
    revision=_approved(c,task_id); task=_task(c,task_id); return _export(c,root,task,revision,'daily_report',f'daily-records/{datetime.now(timezone.utc).date().isoformat()}/{task_id}.md',daily_markdown(revision['content'],task),timestamp)
def candidates(c:sqlite3.Connection,task_id:str)->list[dict[str,Any]]:
    revision=_approved(c,task_id); return [{'candidate_index':i,**x} for i,x in enumerate(revision['content']['sections']['knowledge_candidates'])]
def publish(c:sqlite3.Connection,root:Path,task_id:str,items:list[dict[str,Any]],timestamp:str)->list[dict[str,Any]]:
    revision=_approved(c,task_id); source={i:x for i,x in enumerate(revision['content']['sections']['knowledge_candidates'])}; result=[]
    for item in items:
        index=item['candidate_index']; candidate=source.get(index)
        if candidate is None: raise PublishingError('candidate_not_found','Knowledge candidate was not found')
        value={key:str(item.get(key,candidate[key])).strip() for key in ('title','category','summary','why_reusable')}
        if not all(value.values()): raise PublishingError('publication_invalid','Knowledge publication fields cannot be empty')
        if sum(sum(redact_text(text)[1].values()) for text in value.values()): raise PublishingError('publication_privacy_invalid','Knowledge publication contains sensitive content')
        body=f'# {value["title"]}\n\n分类：{value["category"]}\n\n{value["summary"]}\n\n## 可复用说明\n\n{value["why_reusable"]}\n'; digest=_hash(body); old=c.execute('SELECT * FROM knowledge_publications WHERE revision_id=? AND candidate_index=? AND content_hash=?',(revision['id'],index,digest)).fetchone()
        if old: result.append(dict(old)); continue
        ident=str(uuid.uuid4()); logical=f'published/{_safe(value["category"])}/{ident}.md'; _write(root,logical,body); c.execute("UPDATE knowledge_publications SET status='superseded',superseded_at=?,updated_at=? WHERE revision_id=? AND candidate_index=? AND status='published'",(timestamp,timestamp,revision['id'],index)); c.execute('INSERT INTO knowledge_publications VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',(ident,task_id,revision['id'],index,value['title'],value['category'],value['summary'],value['why_reusable'],logical,digest,'published',timestamp,timestamp,timestamp,None)); result.append(dict(c.execute('SELECT * FROM knowledge_publications WHERE id=?',(ident,)).fetchone()))
    return result
