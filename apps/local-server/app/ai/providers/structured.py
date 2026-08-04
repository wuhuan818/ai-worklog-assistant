"""Strict local validation for ``ai-summary-draft/v1`` provider output."""
from __future__ import annotations

import json
import re
from collections.abc import Iterable
from typing import Any, Dict, Iterable, List, Set, Tuple
from typing_extensions import Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError, constr, field_validator

from app.ai.context.redaction import redact_text

SUMMARY_SCHEMA_VERSION = "ai-summary-draft/v1"
_TEXT = 8000
_REFS = 30
Text = constr(max_length=_TEXT)
EvidenceRef = constr(max_length=1000)


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class EvidenceModel(StrictModel):
    evidence_refs: List[EvidenceRef] = Field(default_factory=list, max_length=_REFS)

    @field_validator("evidence_refs")
    @classmethod
    def unique_refs(cls, value: List[EvidenceRef]) -> List[EvidenceRef]:
        # Stable de-duplication preserves the evidence order given by the model.
        return list(dict.fromkeys(value))


class TaskSummary(EvidenceModel):
    summary: str = Field(max_length=_TEXT)
    outcomes: List[Text] = Field(default_factory=list, max_length=30)


class CodeChange(EvidenceModel):
    path: str = Field(max_length=1000)
    summary: str = Field(max_length=_TEXT)
    impact: str = Field(max_length=_TEXT)

    @field_validator("path")
    @classmethod
    def relative_path_only(cls, value: str) -> str:
        normalized = value.replace("\\", "/")
        if not normalized or normalized.startswith("/") or re.match(r"^[A-Za-z]:", normalized) or ".." in normalized.split("/"):
            raise ValueError("path must be relative and normalized")
        return normalized


class CommandResult(EvidenceModel):
    command: str = Field(max_length=_TEXT)
    result: str = Field(max_length=_TEXT)
    status: Literal["succeeded", "failed", "unknown"]


class BugSolution(EvidenceModel):
    bug_ref: str = Field(max_length=300)
    problem: str = Field(max_length=_TEXT)
    solution: str = Field(max_length=_TEXT)
    verification: str = Field(max_length=_TEXT)


class UnresolvedIssue(EvidenceModel):
    issue: str = Field(max_length=_TEXT)
    impact: str = Field(max_length=_TEXT)
    next_step: str = Field(max_length=_TEXT)


class Todo(EvidenceModel):
    item: str = Field(max_length=_TEXT)
    priority: Literal["high", "medium", "low"]
    rationale: str = Field(max_length=_TEXT)


class DailyReport(EvidenceModel):
    title: str = Field(max_length=1000)
    body: str = Field(max_length=16000)
    highlights: List[Text] = Field(default_factory=list, max_length=30)
    blockers: List[Text] = Field(default_factory=list, max_length=30)
    next_focus: List[Text] = Field(default_factory=list, max_length=30)


class KnowledgeCandidate(EvidenceModel):
    title: str = Field(max_length=1000)
    category: str = Field(max_length=300)
    summary: str = Field(max_length=_TEXT)
    why_reusable: str = Field(max_length=_TEXT)


class SummarySections(StrictModel):
    task_summary: TaskSummary
    code_changes: List[CodeChange] = Field(max_length=100)
    commands_and_results: List[CommandResult] = Field(max_length=100)
    bug_solutions: List[BugSolution] = Field(max_length=100)
    unresolved_issues: List[UnresolvedIssue] = Field(max_length=100)
    todos: List[Todo] = Field(max_length=100)
    daily_report: DailyReport
    knowledge_candidates: List[KnowledgeCandidate] = Field(max_length=50)


class SummaryDraft(StrictModel):
    schema_version: Literal[SUMMARY_SCHEMA_VERSION]
    sections: SummarySections


def summary_json_schema() -> Dict[str, Any]:
    return SummaryDraft.model_json_schema()


def _remove_code_fence(content: str) -> str:
    value = content.strip()
    match = re.fullmatch(r"```(?:json)?\s*\n?(.*?)\n?```", value, flags=re.IGNORECASE | re.DOTALL)
    return match.group(1).strip() if match else value


def _redact(value: Any) -> Tuple[Any, int]:
    if isinstance(value, str):
        text, counts = redact_text(value)
        return text, sum(counts.values())
    if isinstance(value, list):
        items = [_redact(item) for item in value]
        return [item[0] for item in items], sum(item[1] for item in items)
    if isinstance(value, dict):
        items = {key: _redact(item) for key, item in value.items()}
        return {key: item[0] for key, item in items.items()}, sum(item[1] for item in items.values())
    return value, 0


def parse_and_validate_summary(content: str, included_source_refs: Iterable[str]) -> Tuple[SummaryDraft, int]:
    """Parse, redact and validate output; reject a single unknown evidence ref."""
    try:
        decoded = json.loads(_remove_code_fence(content))
    except (TypeError, ValueError) as error:
        raise ValueError("invalid_json") from error
    redacted, redaction_count = _redact(decoded)
    try:
        draft = SummaryDraft.model_validate(redacted)
    except ValidationError as error:
        raise ValueError("schema_invalid") from error
    allowed = set(included_source_refs)
    unknown = {
        ref for ref in _walk_evidence_refs(draft.model_dump()) if ref not in allowed
    }
    if unknown:
        raise ValueError("invalid_evidence_refs")
    return draft, redaction_count


def _walk_evidence_refs(value: Any) -> Iterable[str]:
    if isinstance(value, dict):
        for key, child in value.items():
            if key == "evidence_refs":
                yield from child
            else:
                yield from _walk_evidence_refs(child)
    elif isinstance(value, list):
        for child in value:
            yield from _walk_evidence_refs(child)
