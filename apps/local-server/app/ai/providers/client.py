from __future__ import annotations

import asyncio
from typing import Any, Dict, Optional

import httpx

from .models import ProviderProfile, StructuredSummaryRequest, StructuredSummaryResult
from .prompt import build_summary_messages
from .structured import SummaryDraft, parse_and_validate_summary, summary_json_schema


class ProviderRequestError(Exception):
    def __init__(self, code: str, status_code: Optional[int] = None):
        self.code, self.status_code = code, status_code
        super().__init__(code)


def _error_code(status: int) -> str:
    return {401: "provider_unauthorized", 403: "provider_forbidden", 404: "model_not_found", 408: "provider_timeout", 429: "rate_limited"}.get(status, "provider_error" if status >= 500 else "provider_invalid_response")


def build_generation_payload(request: StructuredSummaryRequest) -> Dict[str, Any]:
    profile = request.profile
    payload: Dict[str, Any] = {"model": profile.model, "messages": build_summary_messages(request.context_package), "stream": False, "max_tokens": profile.max_output_tokens}
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
        message = body["choices"][0]["message"]
        content = message["content"]
    except (TypeError, KeyError, IndexError, ValueError) as error:
        raise ProviderRequestError("provider_invalid_response", response.status_code) from error
    if not isinstance(content, str) or not content.strip():
        raise ProviderRequestError("provider_invalid_response", response.status_code)
    usage = body.get("usage") if isinstance(body, dict) else {}
    usage = usage if isinstance(usage, dict) else {}
    return StructuredSummaryResult(content=content, provider_status=response.status_code, prompt_tokens=usage.get("prompt_tokens"), completion_tokens=usage.get("completion_tokens"), total_tokens=usage.get("total_tokens"))


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
    refs = context.get("provenance", {}).get("included_source_refs", [])
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
        except ValueError as error:
            # A single validation repair retry is allowed; the system contract
            # already requires JSON only, so no raw invalid response is retained.
            last_error = error
            if attempt >= 2:
                raise ProviderRequestError("structured_output_invalid") from error
        await asyncio.sleep(1 if attempt == 1 else 2)
    raise last_error or ProviderRequestError("provider_invalid_response")
