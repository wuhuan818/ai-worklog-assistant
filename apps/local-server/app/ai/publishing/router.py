from typing import List, Optional
from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field
from . import service
from app.ai.generation import repository
router=APIRouter(tags=['summary-publishing'])
class PublishItem(BaseModel):
    candidate_index:int=Field(ge=0); title:Optional[str]=Field(None,max_length=1000); category:Optional[str]=Field(None,max_length=300); summary:Optional[str]=Field(None,max_length=8000); why_reusable:Optional[str]=Field(None,max_length=8000)
class PublishRequest(BaseModel): items:List[PublishItem]=Field(default_factory=list,max_length=50)
def call(action):
    try: return action()
    except service.PublishingError as error: raise HTTPException(400,{'code':error.code,'message':error.message})
@router.get('/tasks/{task_id}/ai/publishing-status')
def publishing_status(task_id:str,authorization:Optional[str]=Header(None)):
    from app import main
    main.auth(authorization); c=main.db(); return {'approved_revision':repository.current_review(c,task_id),'exports':[dict(x) for x in c.execute('SELECT * FROM summary_export_publications WHERE task_id=? ORDER BY published_at DESC',(task_id,))],'knowledge':[dict(x) for x in c.execute('SELECT * FROM knowledge_publications WHERE task_id=? ORDER BY published_at DESC',(task_id,))]}
@router.post('/tasks/{task_id}/ai/exports/summary')
def export_summary(task_id:str,authorization:Optional[str]=Header(None)):
    from app import main
    main.auth(authorization); return call(lambda:service.export_summary(main.db(),main.KNOWLEDGE,task_id,main.now()))
@router.post('/tasks/{task_id}/ai/exports/daily-report')
def export_daily(task_id:str,authorization:Optional[str]=Header(None)):
    from app import main
    main.auth(authorization); return call(lambda:service.export_daily(main.db(),main.KNOWLEDGE,task_id,main.now()))
@router.get('/tasks/{task_id}/ai/exports/{kind}/preview')
def export_preview(task_id:str,kind:str,authorization:Optional[str]=Header(None)):
    from app import main
    main.auth(authorization); return call(lambda:service.export_preview(main.db(),task_id,kind))
@router.get('/tasks/{task_id}/ai/knowledge-candidates')
def knowledge_candidates(task_id:str,authorization:Optional[str]=Header(None)):
    from app import main
    main.auth(authorization); return {'items':call(lambda:service.candidates(main.db(),task_id))}
@router.post('/tasks/{task_id}/ai/knowledge-publications')
def publish_candidates(task_id:str,request:PublishRequest,authorization:Optional[str]=Header(None)):
    from app import main
    main.auth(authorization); return {'items':call(lambda:service.publish(main.db(),main.KNOWLEDGE,task_id,[item.model_dump(exclude_none=True) for item in request.items],main.now()))}
@router.get('/knowledge-publications')
def published_knowledge(authorization:Optional[str]=Header(None)):
    from app import main
    main.auth(authorization); return {'items':[dict(x) for x in main.db().execute("SELECT * FROM knowledge_publications WHERE status='published' ORDER BY updated_at DESC")]}
