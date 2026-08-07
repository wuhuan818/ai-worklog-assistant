from __future__ import annotations

import hashlib
import json
import math
import re
import sqlite3
import struct
import time
from typing import Any, Dict, List, Optional

import httpx

from app.ai.retrieval import service as lexical

CHUNKING_VERSION = "knowledge-chunking/v1"
VECTOR_FORMAT = "float32le/v1"


class SemanticError(Exception):
    def __init__(self, code: str, message: str):
        self.code, self.message = code, message
        super().__init__(message)


def ensure_schema(c: sqlite3.Connection) -> None:
    c.executescript("""
      CREATE TABLE IF NOT EXISTS knowledge_embedding_chunks(
        chunk_id TEXT PRIMARY KEY, publication_id TEXT NOT NULL, ordinal INTEGER NOT NULL,
        text_hash TEXT NOT NULL, content_hash TEXT NOT NULL, profile_fingerprint TEXT NOT NULL,
        provider_kind TEXT NOT NULL, model TEXT NOT NULL, dimensions INTEGER NOT NULL,
        vector_format TEXT NOT NULL, vector_blob BLOB NOT NULL, created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL, UNIQUE(publication_id, ordinal, profile_fingerprint)
      );
      CREATE INDEX IF NOT EXISTS ix_embedding_chunks_profile ON knowledge_embedding_chunks(profile_fingerprint, dimensions);
      CREATE INDEX IF NOT EXISTS ix_embedding_chunks_publication ON knowledge_embedding_chunks(publication_id);
      CREATE TABLE IF NOT EXISTS semantic_index_status(
        profile_fingerprint TEXT PRIMARY KEY, status TEXT NOT NULL, total_chunks INTEGER NOT NULL DEFAULT 0,
        indexed_chunks INTEGER NOT NULL DEFAULT 0, failed_chunks INTEGER NOT NULL DEFAULT 0,
        stale_chunks INTEGER NOT NULL DEFAULT 0, error_code TEXT, model TEXT NOT NULL,
        dimensions INTEGER, updated_at TEXT NOT NULL
      );
    """)


def _safe_base_url(value: str) -> str:
    value = value.strip().rstrip("/")
    if not value.startswith(("https://", "http://")): raise SemanticError("embedding_url_invalid", "Embedding base URL must be HTTP(S)")
    return value


def fingerprint(profile: Dict[str, Any]) -> str:
    material = {"kind": profile["kind"], "base_url": _safe_base_url(profile["base_url"]).lower(), "model": profile["model"], "dimensions": profile.get("dimensions"), "chunking": CHUNKING_VERSION, "vector_format": VECTOR_FORMAT}
    return hashlib.sha256(json.dumps(material, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()


def _hash(value: str) -> str: return hashlib.sha256(value.encode("utf-8")).hexdigest()


def chunks(row: sqlite3.Row, size: int = 1000, overlap: int = 120) -> List[Dict[str, Any]]:
    """Stable small paragraph chunks; no external tokenizer or path material."""
    parts = [f"# {row['title']}", f"分类：{row['category']}", row['summary'], f"可复用说明：{row['why_reusable']}"]
    source = "\n\n".join(part.strip() for part in parts if part and part.strip())
    paragraphs = [item.strip() for item in source.split("\n\n") if item.strip()]
    output: List[str] = []; current = ""
    for paragraph in paragraphs:
        if current and len(current) + len(paragraph) + 2 > size:
            output.append(current)
            current = current[-overlap:] + "\n\n" + paragraph if overlap else paragraph
        else: current = (current + "\n\n" + paragraph).strip()
    if current: output.append(current)
    return [{"chunk_id": f"knowledge-publication:{row['id']}:chunk:{index}", "publication_id": row['id'], "ordinal": index, "text": text, "text_hash": _hash(text), "content_hash": row['content_hash']} for index, text in enumerate(output)]


def _vector(values: Any, dimensions: Optional[int] = None) -> List[float]:
    if not isinstance(values, list) or not values: raise SemanticError("embedding_invalid_vector", "Embedding provider returned no vector")
    try: result = [float(item) for item in values]
    except (TypeError, ValueError): raise SemanticError("embedding_invalid_vector", "Embedding vector contains invalid values")
    if not all(math.isfinite(item) for item in result): raise SemanticError("embedding_invalid_vector", "Embedding vector contains non-finite values")
    if dimensions is not None and len(result) != dimensions: raise SemanticError("embedding_dimension_mismatch", "Embedding dimensions do not match profile")
    return result


async def embed(profile: Dict[str, Any], api_key: str, values: List[str]) -> List[List[float]]:
    if not api_key: raise SemanticError("embedding_key_missing", "Embedding API Key is missing")
    if not values: return []
    started = time.monotonic()
    try:
        async with httpx.AsyncClient(timeout=int(profile.get("timeout_seconds", 30)), follow_redirects=False) as client:
            payload: Dict[str, Any] = {"model": profile["model"], "input": values}
            if profile.get("dimensions"): payload["dimensions"] = profile["dimensions"]
            response = await client.post(f"{_safe_base_url(profile['base_url'])}/embeddings", json=payload, headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"})
    except httpx.TimeoutException as error: raise SemanticError("embedding_timeout", "Embedding provider timed out") from error
    except httpx.HTTPError as error: raise SemanticError("embedding_connection_failed", "Embedding provider connection failed") from error
    if response.status_code >= 400: raise SemanticError("embedding_provider_error", f"Embedding provider returned HTTP {response.status_code}")
    try:
        body = response.json(); data = body["data"]
        vectors = [_vector(item["embedding"], profile.get("dimensions")) for item in sorted(data, key=lambda item: int(item.get("index", 0)))]
    except (TypeError, KeyError, ValueError) as error: raise SemanticError("embedding_invalid_response", "Embedding provider response is invalid") from error
    if len(vectors) != len(values): raise SemanticError("embedding_count_mismatch", "Embedding provider returned an unexpected vector count")
    return vectors


async def test_connection(profile: Dict[str, Any], api_key: str) -> Dict[str, Any]:
    started = time.monotonic(); values = await embed(profile, api_key, ["embedding connection test"]); return {"ok": True, "provider": profile["kind"], "model": profile["model"], "dimensions": len(values[0]), "latency_ms": round((time.monotonic() - started) * 1000)}


def _encode(values: List[float]) -> bytes: return struct.pack("<%sf" % len(values), *values)
def _decode(blob: bytes, dimensions: int) -> List[float]:
    if len(blob) != dimensions * 4: raise SemanticError("embedding_blob_invalid", "Stored vector length is invalid")
    values = list(struct.unpack("<%sf" % dimensions, blob))
    if not all(math.isfinite(item) for item in values): raise SemanticError("embedding_blob_invalid", "Stored vector is invalid")
    return values


async def rebuild(c: sqlite3.Connection, profile: Dict[str, Any], api_key: str, timestamp: str) -> Dict[str, Any]:
    ensure_schema(c); fp = fingerprint(profile)
    rows = c.execute("SELECT * FROM knowledge_publications WHERE status='published' ORDER BY published_at,id").fetchall()
    all_chunks = [chunk for row in rows for chunk in chunks(row)]
    c.execute("INSERT INTO semantic_index_status(profile_fingerprint,status,total_chunks,indexed_chunks,failed_chunks,stale_chunks,error_code,model,dimensions,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(profile_fingerprint) DO UPDATE SET status=excluded.status,total_chunks=excluded.total_chunks,indexed_chunks=0,failed_chunks=0,stale_chunks=excluded.total_chunks,error_code=NULL,model=excluded.model,dimensions=excluded.dimensions,updated_at=excluded.updated_at", (fp,"indexing",len(all_chunks),0,0,len(all_chunks),None,profile["model"],profile.get("dimensions"),timestamp))
    indexed = failed = 0
    try:
        for offset in range(0, len(all_chunks), 16):
            batch = all_chunks[offset:offset + 16]; vectors = await embed(profile, api_key, [item["text"] for item in batch])
            for item, vector in zip(batch, vectors):
                dimensions = len(vector)
                c.execute("INSERT INTO knowledge_embedding_chunks(chunk_id,publication_id,ordinal,text_hash,content_hash,profile_fingerprint,provider_kind,model,dimensions,vector_format,vector_blob,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(chunk_id) DO UPDATE SET text_hash=excluded.text_hash,content_hash=excluded.content_hash,vector_blob=excluded.vector_blob,dimensions=excluded.dimensions,updated_at=excluded.updated_at", (item["chunk_id"],item["publication_id"],item["ordinal"],item["text_hash"],item["content_hash"],fp,profile["kind"],profile["model"],dimensions,VECTOR_FORMAT,_encode(vector),timestamp,timestamp)); indexed += 1
        c.execute("DELETE FROM knowledge_embedding_chunks WHERE profile_fingerprint=? AND publication_id NOT IN (SELECT id FROM knowledge_publications WHERE status='published')", (fp,))
        dimensions = len(vectors[0]) if all_chunks else profile.get("dimensions")
        c.execute("UPDATE semantic_index_status SET status='completed',indexed_chunks=?,failed_chunks=0,stale_chunks=0,dimensions=?,updated_at=? WHERE profile_fingerprint=?", (indexed,dimensions,timestamp,fp))
    except SemanticError as error:
        c.execute("UPDATE semantic_index_status SET status='partial',indexed_chunks=?,failed_chunks=?,error_code=?,updated_at=? WHERE profile_fingerprint=?", (indexed,max(1,len(all_chunks)-indexed),error.code,timestamp,fp)); raise
    return {"profile_fingerprint": fp, "status": "completed", "total_chunks": len(all_chunks), "indexed_chunks": indexed, "failed_chunks": failed}


def status(c: sqlite3.Connection, profile: Dict[str, Any]) -> Dict[str, Any]:
    ensure_schema(c); row=c.execute("SELECT * FROM semantic_index_status WHERE profile_fingerprint=?",(fingerprint(profile),)).fetchone(); return dict(row) if row else {"status":"not_indexed","total_chunks":0,"indexed_chunks":0,"failed_chunks":0,"stale_chunks":0}


def _cosine(left: List[float], right: List[float]) -> float:
    if len(left) != len(right): raise SemanticError("embedding_dimension_mismatch", "Query and index dimensions do not match")
    denom=math.sqrt(sum(x*x for x in left))*math.sqrt(sum(x*x for x in right))
    return sum(x*y for x,y in zip(left,right))/denom if denom else 0.0


async def semantic_search(c: sqlite3.Connection, query: str, profile: Dict[str, Any], api_key: str, limit: int, category: Optional[str]) -> List[Dict[str, Any]]:
    current=status(c,profile)
    if current["status"] != "completed": raise SemanticError("semantic_index_not_ready", "Semantic index has not been built")
    query_vector=(await embed(profile,api_key,[query]))[0]; fp=fingerprint(profile)
    rows=c.execute("SELECT e.*,p.title,p.category,p.summary,p.why_reusable,p.published_at,p.task_id,p.revision_id,p.logical_path FROM knowledge_embedding_chunks e JOIN knowledge_publications p ON p.id=e.publication_id WHERE e.profile_fingerprint=? AND p.status='published'" + (" AND p.category=?" if category else ""),(fp,category) if category else (fp,)).fetchall()
    scored=[]
    for row in rows:
        score=_cosine(query_vector,_decode(row['vector_blob'],row['dimensions'])); scored.append((score,row))
    scored.sort(key=lambda item:(-item[0],item[1]['published_at'],item[1]['chunk_id']))
    seen=set(); result=[]
    for score,row in scored:
        if row['publication_id'] in seen: continue
        seen.add(row['publication_id']); result.append({"publication_id":row['publication_id'],"source_ref":f"knowledge-publication:{row['publication_id']}","chunk_ref":row['chunk_id'],"title":row['title'],"category":row['category'],"snippet":lexical._snippet(row,query),"semantic_score":round(score,6),"published_at":row['published_at'],"task_id":row['task_id'],"revision_id":row['revision_id'],"logical_path":row['logical_path']})
        if len(result)>=limit: break
    return result


async def retrieve(c: sqlite3.Connection, query: str, mode: str, limit: int, category: Optional[str], profile: Optional[Dict[str,Any]], api_key: Optional[str]) -> Dict[str, Any]:
    lexical_items=lexical.search(c,query,max(limit*3,20),category)
    if mode == 'lexical' or not profile: return {"query":query,"requested_mode":mode,"effective_mode":"lexical" if mode=='lexical' else "lexical_fallback","fallback_reason":None if mode=='lexical' else "embedding_not_configured","index_status":"not_configured","items":lexical_items[:limit]}
    try: semantic_items=await semantic_search(c,query,profile,api_key or '',max(limit*3,20),category)
    except SemanticError as error:
        if mode=='semantic': raise
        return {"query":query,"requested_mode":mode,"effective_mode":"lexical_fallback","fallback_reason":error.code,"index_status":status(c,profile)["status"],"items":lexical_items[:limit]}
    if mode=='semantic': return {"query":query,"requested_mode":mode,"effective_mode":"semantic","index_status":"completed","items":[{**item,"rank":index+1} for index,item in enumerate(semantic_items[:limit])]}
    merged: Dict[str,Dict[str,Any]]={}
    for index,item in enumerate(lexical_items,1): merged.setdefault(item['publication_id'],{**item})['lexical_rank']=index
    for index,item in enumerate(semantic_items,1): merged.setdefault(item['publication_id'],{**item})['semantic_rank']=index
    def rrf(item:Dict[str,Any])->float:return sum(1/(60+item[key]) for key in ('lexical_rank','semantic_rank') if key in item)
    items=sorted(merged.values(),key=lambda item:(-rrf(item),item['publication_id']))[:limit]
    return {"query":query,"requested_mode":mode,"effective_mode":"hybrid","index_status":"completed","items":[{**item,"fused_score":round(rrf(item),8),"rank":index+1} for index,item in enumerate(items)]}
