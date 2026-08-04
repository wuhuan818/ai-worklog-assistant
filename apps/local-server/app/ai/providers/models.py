from __future__ import annotations

from typing import Any, Dict, Optional
from typing_extensions import Literal

from pydantic import BaseModel, Field, SecretStr, field_validator

from app.ai.router import PROVIDERS, normalize_base_url


class ProviderProfile(BaseModel):
    """Ephemeral profile supplied by the extension for one provider request."""

    profile_id: str = Field(min_length=1, max_length=200)
    provider: Literal["deepseek", "qwen", "openai-compatible"]
    base_url: str
    model: str = Field(min_length=1, max_length=200)
    api_key: SecretStr = Field(min_length=1, max_length=4096)
    thinking_enabled: bool = False
    timeout_seconds: int = Field(default=120, ge=1, le=180)
    max_output_tokens: int = Field(default=8192, ge=1, le=8192)
    structured_output_mode: Literal["json_schema", "json_object", "prompt_only"] = "json_object"

    @field_validator("base_url")
    @classmethod
    def valid_base_url(cls, value: str) -> str:
        return normalize_base_url(value)


class StructuredSummaryRequest(BaseModel):
    profile: ProviderProfile
    context_package: Dict[str, Any]
    prompt_version: str = "ai-summary-prompt/v1"
    output_schema_version: str = "ai-summary-draft/v1"
    repair_instruction: Optional[str] = None


class StructuredSummaryResult(BaseModel):
    content: str = Field(min_length=1)
    # Safe diagnostics only.  These describe the final-content envelope and
    # never retain Provider text or reasoning.
    content_shape: str = Field(default="string", max_length=100)
    content_characters: int = Field(default=0, ge=0)
    provider_status: int = 200
    prompt_tokens: Optional[int] = Field(default=None, ge=0)
    completion_tokens: Optional[int] = Field(default=None, ge=0)
    total_tokens: Optional[int] = Field(default=None, ge=0)
