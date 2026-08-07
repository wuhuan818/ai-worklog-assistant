from typing import Optional
from fastapi import APIRouter, Header, HTTPException, Query
from . import service

router = APIRouter(tags=['knowledge-retrieval'])

@router.get('/knowledge/search')
def knowledge_search(q: str = Query(..., min_length=1, max_length=200), limit: int = Query(10, ge=1, le=50), category: Optional[str] = Query(None, max_length=300), authorization: Optional[str] = Header(None)):
    from app import main
    main.auth(authorization)
    try:
        return {'items': service.search(main.db(), q, limit, category), 'query': q, 'limit': limit}
    except service.RetrievalError as error:
        raise HTTPException(400, {'code': error.code, 'message': error.message})
