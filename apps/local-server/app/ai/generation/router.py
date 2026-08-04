from __future__ import annotations

import asyncio
from typing import Optional
from typing_extensions import Literal

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field, SecretStr, validator

from . import repository, service

router = APIRouter(tags=["ai-generation"])
_tasks: dict[str, asyncio.Task] = {}


class GenerationProfile(BaseModel):
    profile_id: str = Field(min_length=1, max_length=200)
    provider: str
    base_url: str = Field(min_length=1, max_length=2000)
    model: str = Field(min_length=1, max_length=200)
    thinking_enabled: bool = False
    timeout_seconds: int = Field(default=120, ge=1, le=180)
    max_output_tokens: int = Field(default=8192, ge=1, le=8192)
    structured_output_mode: Literal["json_schema", "json_object", "prompt_only"] = "json_object"
    api_key: Optional[SecretStr] = Field(default=None, exclude=True)
    @validator("provider")
    def provider_supported(cls, value: str) -> str:
        if value not in {"deepseek", "qwen", "openai-compatible"}: raise ValueError("invalid_profile")
        return value


class CreateGenerationRequest(BaseModel):
    profile: GenerationProfile
    idempotency_key: str = Field(min_length=1, max_length=200)


def _error(error: service.GenerationError):
    raise HTTPException(400, {"code": error.code, "message": error.message})


def _generator():
    # Integration seam: tests may install app.state.summary_generator.  The
    # production adapter from Agent A is discovered lazily to avoid a cycle.
    from app import main
    value = getattr(main.app.state, "summary_generator", None)
    if value: return value
    try:
        from app.ai.providers import generate_validated_summary
        return generate_validated_summary
    except ImportError:
        return None


@router.post("/ai/context-packages/{context_id}/summary-generations")
async def create_generation(context_id: str, request: CreateGenerationRequest, authorization: Optional[str] = Header(None)):
    from app import main
    main.auth(authorization); c = main.db()
    try:
        job, created = service.create_job(c, context_id, request.profile.model_dump(exclude={"api_key"}), request.idempotency_key, main.now())
    except service.GenerationError as error: _error(error)
    if created:
        api_key = request.profile.api_key.get_secret_value() if request.profile.api_key else ""
        if not api_key:
            c.execute("UPDATE ai_generation_jobs SET status='failed',error_code='provider_key_missing',error_summary='Provider API Key is missing',finished_at=? WHERE id=?", (main.now(), job["id"]))
        else:
            generator = _generator()
            if generator is None:
                c.execute("UPDATE ai_generation_jobs SET status='failed',error_code='provider_not_configured',error_summary='Structured summary provider is not configured',finished_at=? WHERE id=?", (main.now(), job["id"]))
            else:
                _tasks[job["id"]] = asyncio.create_task(service.run_job(main.db, job["id"], request.profile.model_dump(exclude={"api_key"}), api_key, generator, main.now))
    return {"job_id": job["id"], "status": "queued" if created else job["status"]}


@router.get("/ai/generation-jobs/{job_id}")
def generation_job(job_id: str, authorization: Optional[str] = Header(None)):
    from app import main
    main.auth(authorization); job = repository.get_job(main.db(), job_id)
    if not job: raise HTTPException(404, {"code": "generation_not_found", "message": "Generation job was not found"})
    return job


@router.post("/ai/generation-jobs/{job_id}/cancel")
def cancel_generation(job_id: str, authorization: Optional[str] = Header(None)):
    from app import main
    main.auth(authorization)
    try: job = service.cancel_job(main.db(), job_id, main.now())
    except service.GenerationError as error: _error(error)
    task = _tasks.pop(job_id, None)
    if task: task.cancel()
    return job


@router.get("/tasks/{task_id}/ai/summary-drafts")
def drafts_for_task(task_id: str, authorization: Optional[str] = Header(None)):
    from app import main
    main.auth(authorization); return {"items": repository.list_drafts(main.db(), task_id)}


@router.get("/ai/summary-drafts/{draft_id}")
def summary_draft(draft_id: str, authorization: Optional[str] = Header(None)):
    from app import main
    main.auth(authorization); draft = repository.get_draft(main.db(), draft_id)
    if not draft: raise HTTPException(404, {"code": "draft_not_found", "message": "Summary draft was not found"})
    return draft
