from typing import Any, Dict, List, Optional
import hashlib, json
import httpx
from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field, SecretStr, validator
from . import service

router=APIRouter(tags=['semantic-rag'])
class EmbeddingProfile(BaseModel):
    id:str=Field(min_length=1,max_length=200); name:str=Field(min_length=1,max_length=200); kind:str
    base_url:str=Field(min_length=8,max_length=1000); model:str=Field(min_length=1,max_length=300)
    dimensions:Optional[int]=Field(None,ge=1,le=10000); timeout_seconds:int=Field(30,ge=3,le=120); enabled:bool=True; api_key:SecretStr
    @validator('kind')
    def valid_kind(cls,value):
        if value not in {'qwen','openai-compatible'}: raise ValueError('embedding kind must be qwen or openai-compatible')
        return value
class RetrieveRequest(BaseModel):
    query:str=Field(min_length=1,max_length=200); mode:str='hybrid'; limit:int=Field(10,ge=1,le=50); category:Optional[str]=Field(None,max_length=300); embedding_profile:Optional[EmbeddingProfile]=None
    @validator('mode')
    def valid_mode(cls,value):
        if value not in {'lexical','semantic','hybrid'}: raise ValueError('mode must be lexical, semantic, or hybrid')
        return value
class ChatProfile(BaseModel):
    profile_id:str=Field(min_length=1,max_length=200); provider:str; base_url:str=Field(min_length=8,max_length=1000); model:str=Field(min_length=1,max_length=300); thinking_enabled:bool=False; timeout_seconds:int=Field(30,ge=3,le=120); max_output_tokens:int=Field(1000,ge=128,le=8000); api_key:SecretStr
class RagRequest(RetrieveRequest): chat_profile:ChatProfile
def _error(error:service.SemanticError): raise HTTPException(400,{'code':error.code,'message':error.message})
def _profile(value:EmbeddingProfile)->Dict[str,Any]: return value.model_dump(exclude={'api_key'})
@router.post('/knowledge/embedding/test')
async def embedding_test(request:EmbeddingProfile,authorization:Optional[str]=Header(None)):
    from app import main
    main.auth(authorization)
    try:return await service.test_connection(_profile(request),request.api_key.get_secret_value())
    except service.SemanticError as error:_error(error)
@router.get('/knowledge/semantic-index/status')
def semantic_status(profile_fingerprint:str,authorization:Optional[str]=Header(None)):
    from app import main
    main.auth(authorization); service.ensure_schema(main.db()); row=main.db().execute('SELECT * FROM semantic_index_status WHERE profile_fingerprint=?',(profile_fingerprint,)).fetchone(); return dict(row) if row else {'status':'not_indexed','total_chunks':0,'indexed_chunks':0,'failed_chunks':0,'stale_chunks':0}
@router.post('/knowledge/semantic-index/rebuild')
async def semantic_rebuild(request:EmbeddingProfile,authorization:Optional[str]=Header(None)):
    from app import main
    main.auth(authorization)
    try:return await service.rebuild(main.db(),_profile(request),request.api_key.get_secret_value(),main.now())
    except service.SemanticError as error:_error(error)
@router.post('/knowledge/retrieve')
async def retrieve(request:RetrieveRequest,authorization:Optional[str]=Header(None)):
    from app import main
    main.auth(authorization)
    try:return await service.retrieve(main.db(),request.query,request.mode,request.limit,request.category,_profile(request.embedding_profile) if request.embedding_profile else None,request.embedding_profile.api_key.get_secret_value() if request.embedding_profile else None)
    except service.SemanticError as error:_error(error)
async def _chat(profile:ChatProfile,context:Dict[str,Any])->Dict[str,Any]:
    sources=context['sources']; prompt="只依据下列已发布知识回答。证据不足时设置 insufficient_evidence=true。citation 的 source_ref 必须来自来源列表。返回 JSON：{answer:string,citations:[{source_ref:string}],insufficient_evidence:boolean}。\n"+json.dumps({'question':context['user_query'],'sources':sources},ensure_ascii=False,separators=(',',':'))
    try:
        async with httpx.AsyncClient(timeout=profile.timeout_seconds,follow_redirects=False) as client: response=await client.post(profile.base_url.rstrip('/')+'/chat/completions',json={'model':profile.model,'messages':[{'role':'system','content':'You provide grounded knowledge-base answers only.'},{'role':'user','content':prompt}],'response_format':{'type':'json_object'},'stream':False,'max_tokens':profile.max_output_tokens},headers={'Authorization':'Bearer '+profile.api_key.get_secret_value(),'Content-Type':'application/json'})
    except httpx.TimeoutException as error: raise service.SemanticError('rag_provider_timeout','Chat provider timed out') from error
    except httpx.HTTPError as error: raise service.SemanticError('rag_provider_connection_failed','Chat provider connection failed') from error
    if response.status_code>=400:raise service.SemanticError('rag_provider_error',f'Chat provider returned HTTP {response.status_code}')
    try: content=response.json()['choices'][0]['message']['content']; answer=json.loads(content if isinstance(content,str) else content.get('text',''))
    except (TypeError,KeyError,ValueError):raise service.SemanticError('rag_output_invalid','Chat provider returned invalid grounded answer')
    if not isinstance(answer,dict) or not isinstance(answer.get('answer'),str) or not isinstance(answer.get('citations'),list):raise service.SemanticError('rag_output_invalid','Chat provider returned invalid grounded answer')
    allowed={source['source_ref'] for source in sources}; citations=[]
    for citation in answer['citations']:
        ref=citation.get('source_ref') if isinstance(citation,dict) else None
        if ref not in allowed:raise service.SemanticError('rag_citation_invalid','Chat provider cited a source outside this retrieval')
        if ref not in {item['source_ref'] for item in citations}:citations.append({'source_ref':ref})
    if not answer.get('insufficient_evidence') and not citations:raise service.SemanticError('rag_citation_missing','Grounded answer requires at least one valid citation')
    return {'schema_version':'rag-answer/v1','answer':answer['answer'].strip(),'citations':citations,'insufficient_evidence':bool(answer.get('insufficient_evidence'))}
@router.post('/knowledge/rag-answers')
async def rag_answer(request:RagRequest,authorization:Optional[str]=Header(None)):
    from app import main
    main.auth(authorization)
    try: retrieval=await service.retrieve(main.db(),request.query,request.mode,request.limit,request.category,_profile(request.embedding_profile) if request.embedding_profile else None,request.embedding_profile.api_key.get_secret_value() if request.embedding_profile else None)
    except service.SemanticError as error:_error(error)
    if not retrieval['items']:return {'schema_version':'rag-answer/v1','answer':'知识库中没有找到足够相关的已发布知识。','citations':[],'insufficient_evidence':True,'requested_retrieval_mode':request.mode,'effective_retrieval_mode':retrieval['effective_mode'],'source_summaries':[],'provider':request.chat_profile.provider,'model':request.chat_profile.model}
    sources=[{key:item[key] for key in ('source_ref','publication_id','title','category','snippet','rank') if key in item} for item in retrieval['items']]
    context={'schema_version':'rag-context-package/v1','user_query':request.query,'retrieval_mode':retrieval['effective_mode'],'sources':sources[:8]}; result=await _chat(request.chat_profile,context)
    return {**result,'requested_retrieval_mode':request.mode,'effective_retrieval_mode':retrieval['effective_mode'],'fallback_reason':retrieval.get('fallback_reason'),'source_summaries':sources,'provider':request.chat_profile.provider,'model':request.chat_profile.model,'context_hash':hashlib.sha256(json.dumps(context,ensure_ascii=False,sort_keys=True).encode()).hexdigest()}
