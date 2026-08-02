from __future__ import annotations
import time
from typing import Optional
from urllib.parse import urlparse, urlunparse

import httpx
from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field, SecretStr, validator

router = APIRouter(prefix="/ai/providers", tags=["ai"])
PROVIDERS = {"deepseek", "qwen", "openai-compatible"}

def normalize_base_url(value: str) -> str:
    try:
        parsed = urlparse(value.strip())
    except ValueError as error:
        raise ValueError("invalid_base_url") from error
    if parsed.scheme not in {"https", "http"} or not parsed.netloc or parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise ValueError("invalid_base_url")
    host = parsed.hostname or ""
    if parsed.scheme == "http" and host not in {"localhost", "127.0.0.1", "::1"}:
        raise ValueError("invalid_base_url")
    path = parsed.path.rstrip("/")
    if path.endswith("/chat/completions"):
        raise ValueError("invalid_base_url")
    return urlunparse((parsed.scheme, parsed.netloc, path, "", "", ""))

class ConnectionTestRequest(BaseModel):
    provider: str
    base_url: str
    model: str = Field(min_length=1, max_length=200)
    api_key: SecretStr = Field(min_length=1, max_length=4096)
    thinking_enabled: bool = False
    timeout_seconds: int = Field(default=30, ge=1, le=60)
    max_output_tokens: int = Field(default=16, ge=1, le=32)

    @validator("provider")
    def valid_provider(cls, value: str) -> str:
        if value not in PROVIDERS: raise ValueError("invalid_profile")
        return value

    @validator("base_url")
    def valid_url(cls, value: str) -> str: return normalize_base_url(value)

def payload_for(request: ConnectionTestRequest) -> dict:
    payload = {"model": request.model, "messages": [{"role": "system", "content": "Return a short connection-test response."}, {"role": "user", "content": "Reply with OK."}], "stream": False, "max_tokens": request.max_output_tokens}
    if request.provider == "deepseek":
        payload["thinking"] = {"type": "enabled" if request.thinking_enabled else "disabled"}
        if request.thinking_enabled: payload["reasoning_effort"] = "high"
    elif request.provider == "qwen":
        payload["enable_thinking"] = request.thinking_enabled
    return payload

def error_category(status: int) -> str:
    return {401: "unauthorized", 403: "forbidden", 404: "model_not_found", 408: "timeout", 429: "rate_limited"}.get(status, "provider_error" if status >= 500 else "invalid_response")

def safe_detail(category: str) -> str:
    return {"unauthorized": "API Key 无效或无权访问该模型", "forbidden": "没有访问该模型的权限", "model_not_found": "模型名称不存在或当前地域不可用", "rate_limited": "请求频率受限，请稍后重试", "timeout": "请求超时，请检查网络或 Base URL", "connection_failed": "无法连接到 Provider", "invalid_response": "Provider 返回了无效响应", "provider_error": "Provider 服务暂时不可用"}.get(category, "AI Provider 配置无效")

@router.post("/test-connection")
async def test_connection(request: ConnectionTestRequest, authorization: Optional[str] = Header(None)):
    # Local-session auth is deliberately checked here, but the external key is only
    # used in this request scope and is neither logged nor returned.
    from app import main
    main.auth(authorization)
    started = time.monotonic()
    try:
        async with httpx.AsyncClient(timeout=request.timeout_seconds, follow_redirects=False) as client:
            response = await client.post(f"{request.base_url}/chat/completions", json=payload_for(request), headers={"Authorization": f"Bearer {request.api_key.get_secret_value()}", "Content-Type": "application/json"})
        if response.status_code >= 400:
            category = error_category(response.status_code)
            raise HTTPException(400, {"code": category, "message": safe_detail(category)})
        if len(response.content) > 65536:
            raise HTTPException(400, {"code": "invalid_response", "message": safe_detail("invalid_response")})
        try:
            data = response.json()
        except ValueError:
            raise HTTPException(400, {"code": "invalid_response", "message": safe_detail("invalid_response")})
        if not isinstance(data, dict) or not data.get("choices"):
            raise HTTPException(400, {"code": "invalid_response", "message": safe_detail("invalid_response")})
    except HTTPException:
        raise
    except httpx.TimeoutException:
        raise HTTPException(400, {"code": "timeout", "message": safe_detail("timeout")})
    except httpx.HTTPError:
        raise HTTPException(400, {"code": "connection_failed", "message": safe_detail("connection_failed")})
    return {"ok": True, "provider": request.provider, "model": request.model, "latency_ms": round((time.monotonic() - started) * 1000), "status": "connected", "capabilities": {"chat_completions": True, "thinking_toggle": request.provider != "openai-compatible", "json_mode": True}}
