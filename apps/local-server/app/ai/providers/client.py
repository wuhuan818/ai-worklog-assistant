from __future__ import annotations

import asyncio
import json
from typing import Any, Dict, Optional

import httpx

from .models import ProviderProfile, StructuredSummaryRequest, StructuredSummaryResult
from app.ai.context.redaction import redact_text
from .prompt import build_repair_messages, build_summary_messages
from .structured import SummaryValidationError, normalize_evidence_refs, parse_and_validate_summary, summary_json_schema

MIN_STRUCTURED_OUTPUT_TOKENS = 2048


class ProviderRequestError(Exception):
    def __init__(self, code: str, status_code: Optional[int] = None, summary: Optional[str] = None):
        self.code, self.status_code, self.summary = code, status_code, summary or code
        super().__init__(code)


def _error_code(status: int) -> str:
    return {401: "provider_unauthorized", 403: "provider_forbidden", 404: "model_not_found", 408: "provider_timeout", 429: "rate_limited"}.get(status, "provider_error" if status >= 500 else "provider_invalid_response")


def build_generation_payload(request: StructuredSummaryRequest) -> Dict[str, Any]:
    profile = request.profile
    messages = build_summary_messages(request.context_package) if not request.repair_instruction else build_repair_messages(request.context_package, *json.loads(request.repair_instruction))
    # Full ai-summary-draft/v1 output cannot fit legacy values such as 16.
    payload: Dict[str, Any] = {"model": profile.model, "messages": messages, "stream": False, "max_tokens": max(profile.max_output_tokens, MIN_STRUCTURED_OUTPUT_TOKENS)}
    if profile.structured_output_mode == "json_schema":
        payload["response_format"] = {"type": "json_schema", "json_schema": {"name": "ai_summary_draft", "strict": True, "schema": summary_json_schema()}}
    elif profile.structured_output_mode == "json_object":
        payload["response_format"] = {"type": "json_object"}
    if profile.provider == "deepseek":
        payload["thinking"] = {"type": "enabled" if profile.thinking_enabled else "disabled"}
        if profile.thinking_enabled:
            payload["reasoning_effort"] = "high"
    elif profile.provider == "qwen":
        payload["enable_thinking"] = profile.thinking_enabled
    return payload


def _final_content(value: Any) -> tuple[str, str]:
    """Extract final answer text and a safe envelope description only."""
    if isinstance(value, str): return value, "string"
    if isinstance(value, list):
        extracted = [_final_content(item) for item in value]
        return "".join(part for part, _ in extracted if part), "parts[" + ",".join(sorted(set(shape for _, shape in extracted)))[:70] + "]"
    if isinstance(value, dict):
        text = value.get("text")
        if isinstance(text, str): return text, "object:text"
        if isinstance(text, dict) and isinstance(text.get("value"), str): return text["value"], "object:text.value"
        return "", "object:unsupported"
    return "", type(value).__name__


async def generate_structured_summary(request: StructuredSummaryRequest) -> StructuredSummaryResult:
    """Call exactly the configured provider and return final content only (never reasoning)."""
    profile = request.profile
    try:
        async with httpx.AsyncClient(timeout=profile.timeout_seconds, follow_redirects=False) as client:
            response = await client.post(f"{profile.base_url}/chat/completions", json=build_generation_payload(request), headers={"Authorization": f"Bearer {profile.api_key.get_secret_value()}", "Content-Type": "application/json"})
    except httpx.TimeoutException as error:
        raise ProviderRequestError("provider_timeout") from error
    except httpx.HTTPError as error:
        raise ProviderRequestError("provider_connection_failed") from error
    if response.status_code >= 400:
        raise ProviderRequestError(_error_code(response.status_code), response.status_code)
    if len(response.content) > 2_000_000:
        raise ProviderRequestError("output_too_large", response.status_code)
    try:
        body = response.json()
        choice = body["choices"][0]
        message = choice["message"]
        content, content_shape = _final_content(message.get("content"))
    except (TypeError, KeyError, IndexError, ValueError) as error:
        raise ProviderRequestError("provider_invalid_response", response.status_code) from error
    if not content.strip():
        raise ProviderRequestError("provider_empty_content", response.status_code, "Provider returned no final content")
    usage = body.get("usage") if isinstance(body, dict) else {}
    usage = usage if isinstance(usage, dict) else {}
    finish_reason = choice.get("finish_reason") if isinstance(choice.get("finish_reason"), str) else None
    return StructuredSummaryResult(content=content, content_shape=content_shape, content_characters=len(content), finish_reason=finish_reason, provider_status=response.status_code, prompt_tokens=usage.get("prompt_tokens"), completion_tokens=usage.get("completion_tokens"), total_tokens=usage.get("total_tokens"))


async def generate_validated_summary(profile: Any, api_key: str, context: Dict[str, Any]):
    """One-call convenience API for the generation service.

    ``profile`` may be a ``ProviderProfile`` or a secret-free profile mapping.
    The API key is injected only into the ephemeral request model.  The returned
    mapping contains validated ``content``, usage fields and output redaction count.
    """
    if isinstance(profile, ProviderProfile):
        profile_data = profile.model_dump()
    elif hasattr(profile, "model_dump"):
        profile_data = profile.model_dump()
    elif hasattr(profile, "dict"):
        profile_data = profile.dict()
    else:
        profile_data = dict(profile)
    profile_data["api_key"] = api_key
    request = StructuredSummaryRequest(profile=ProviderProfile(**profile_data), context_package=context)
    refs = normalize_evidence_refs(context.get("provenance", {}).get("included_source_refs", []))
    # At most three paid calls: one repair retry for malformed output, and
    # bounded transport retries only for transient provider failures.  Keys stay
    # inside ``request`` for this coroutine's lifetime.
    transient = {"rate_limited", "provider_error", "provider_timeout", "provider_connection_failed"}
    last_error: Optional[Exception] = None
    for attempt in range(1, 4):
        try:
            result = await generate_structured_summary(request)
            draft, redaction_count = parse_and_validate_summary(result.content, refs)
            return {
                "content": draft.model_dump(),
                "prompt_tokens": result.prompt_tokens,
                "completion_tokens": result.completion_tokens,
                "total_tokens": result.total_tokens,
                "output_redaction_count": redaction_count,
                "provider_status": result.provider_status,
                "attempt_count": attempt,
            }
        except ProviderRequestError as error:
            last_error = error
            if error.code not in transient or attempt == 3:
                raise
        except SummaryValidationError as error:
            # One targeted repair request stays with the selected Provider.  The
            # previous answer is redacted and never persisted or logged.
            last_error = error
            if attempt >= 2:
                detail = ", ".join(error.paths) or "$"
                shape = result.content_shape
                finish = result.finish_reason or "unspecified"
                raise ProviderRequestError("structured_output_invalid", summary=f"AI 返回内容未通过结构化校验：{error.stage} at {detail}（final_content={shape}, chars={result.content_characters}, finish_reason={finish}）。已尝试 {attempt} 次，未创建草稿。") from error
            safe_output, _ = redact_text(result.content)
            request = request.model_copy(update={"repair_instruction": json.dumps([error.stage, error.paths, list(refs), safe_output], ensure_ascii=False)})
        await asyncio.sleep(1 if attempt == 1 else 2)
    raise last_error or ProviderRequestError("provider_invalid_response")
