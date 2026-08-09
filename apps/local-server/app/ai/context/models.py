from __future__ import annotations

from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field, validator

SCHEMA_VERSION = "task-context-package/v1"
CONFIG_SCHEMA_VERSION = "context-build-config/v1"

class ContextBuildConfig(BaseModel):
    schema_version: str = CONFIG_SCHEMA_VERSION
    estimated_input_token_budget: int = Field(32000, ge=4000, le=128000)
    include_manual_notes: bool = True
    include_bug_details: bool = True
    include_file_changes: bool = True
    include_diff_snippets: bool = True
    include_diagnostics: bool = True
    include_commands_and_tasks: bool = True
    include_debug_events: bool = True
    include_event_summary: bool = True

    @validator("schema_version")
    def v1_only(cls, value: str) -> str:
        if value != CONFIG_SCHEMA_VERSION:
            raise ValueError("unsupported schema_version")
        return value

class ContextBuildRequest(BaseModel):
    config: ContextBuildConfig = Field(default_factory=ContextBuildConfig)
    idempotency_key: Optional[str] = Field(None, min_length=1, max_length=200)

class ContextPackage(BaseModel):
    schema_version: str = SCHEMA_VERSION
    context_id: str
    status: str = "preview"
    project: Dict[str, Any]
    task: Dict[str, Any]
    bugs: List[Dict[str, Any]] = Field(default_factory=list)
    file_changes: List[Dict[str, Any]] = Field(default_factory=list)
    code_diffs: List[Dict[str, Any]] = Field(default_factory=list)
    diagnostics: List[Dict[str, Any]] = Field(default_factory=list)
    commands_and_tasks: List[Dict[str, Any]] = Field(default_factory=list)
    debug_events: List[Dict[str, Any]] = Field(default_factory=list)
    event_summary: Dict[str, Any] = Field(default_factory=dict)
    statistics: Dict[str, Any] = Field(default_factory=dict)
    provenance: Dict[str, Any] = Field(default_factory=dict)
    privacy: Dict[str, Any] = Field(default_factory=dict)
    budget: Dict[str, Any] = Field(default_factory=dict)
    content_hash: str
    created_at: Optional[str] = None
    updated_at: Optional[str] = None
    ready_at: Optional[str] = None
