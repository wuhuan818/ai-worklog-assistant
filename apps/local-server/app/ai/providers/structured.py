"""Strict local validation for ``ai-summary-draft/v1`` provider output."""
from __future__ import annotations

import json
import re
from collections.abc import Iterable
from typing import Any, Dict, Iterable, List, Tuple
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


class SummaryValidationError(ValueError):
    """Safe, field-oriented validation diagnostics; never includes raw output."""
    def __init__(self, stage: str, paths: Iterable[str] = ()):
        self.stage = stage
        self.paths = list(dict.fromkeys(paths))[:3]
        super().__init__(stage)


def normalize_evidence_refs(values: Iterable[Any]) -> List[str]:
    """Turn Context provenance references into the stable strings used by drafts.

    Context packages store event provenance as ``{type, id}`` objects, while the
    public draft schema deliberately exposes evidence references as strings.  Do
    the conversion in one place so prompts, repair requests and local validation
    all use the exact same allow-list.
    """
    normalized: List[str] = []
    for value in values:
        if isinstance(value, str):
            candidate = value
        elif isinstance(value, dict) and isinstance(value.get("type"), str) and isinstance(value.get("id"), str):
            candidate = f"{value['type']}:{value['id']}"
        else:
            continue
        if candidate and candidate not in normalized:
            normalized.append(candidate)
    return normalized


def summary_json_schema() -> Dict[str, Any]:
    return SummaryDraft.model_json_schema()


def _remove_code_fence(content: str) -> str:
    value = content.strip()
    match = re.fullmatch(r"```(?:json)?\s*\n?(.*?)\n?```", value, flags=re.IGNORECASE | re.DOTALL)
    return match.group(1).strip() if match else value


def _unique_json_object(content: str) -> str:
    """Return exactly one balanced JSON object, safely ignoring quoted braces."""
    value = _remove_code_fence(content)
    candidates: List[str] = []
    start = None; depth = 0; quoted = False; escaped = False
    for index, char in enumerate(value):
        if start is None:
            if char == "{": start = index; depth = 1; quoted = False; escaped = False
            continue
        if quoted:
            if escaped: escaped = False
            elif char == "\\": escaped = True
            elif char == '"': quoted = False
            continue
        if char == '"': quoted = True
        elif char == "{": depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                candidates.append(value[start:index + 1]); start = None
    if start is not None:
        raise SummaryValidationError("json_extraction_unterminated", ["$"])
    if not candidates:
        raise SummaryValidationError("json_extraction_no_object", ["$"])
    if len(candidates) != 1:
        raise SummaryValidationError("json_extraction_multiple_objects", ["multiple_json_objects"])
    return candidates[0]


def _validation_paths(error: ValidationError) -> List[str]:
    paths = []
    for item in error.errors():
        location = item.get("loc", ())
        path = ".".join(str(part) for part in location)
        if path: paths.append(path)
    return paths


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
    """Parse one JSON object, validate facts, redact output, then validate again."""
    try:
        decoded = json.loads(_unique_json_object(content))
    except (TypeError, ValueError) as error:
        if isinstance(error, SummaryValidationError): raise
        raise SummaryValidationError("json_parse", ["$"]) from error
    try:
        draft = SummaryDraft.model_validate(decoded)
    except ValidationError as error:
        raise SummaryValidationError("schema", _validation_paths(error)) from error
    allowed = set(normalize_evidence_refs(included_source_refs))
    unknown = {
        ref for ref in _walk_evidence_refs(draft.model_dump()) if ref not in allowed
    }
    if unknown:
        paths = []
        for path, ref in _walk_evidence_ref_paths(draft.model_dump()):
            if ref in unknown: paths.append(path)
        raise SummaryValidationError("evidence", paths or ["evidence_refs"])
    redacted, redaction_count = _redact(draft.model_dump())
    try:
        return SummaryDraft.model_validate(redacted), redaction_count
    except ValidationError as error:
        raise SummaryValidationError("post_redaction_schema", _validation_paths(error)) from error


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


def _walk_evidence_ref_paths(value: Any, prefix: str = "") -> Iterable[Tuple[str, str]]:
    if isinstance(value, dict):
        for key, child in value.items():
            path = f"{prefix}.{key}" if prefix else key
            if key == "evidence_refs":
                for index, ref in enumerate(child): yield f"{path}.{index}", ref
            else: yield from _walk_evidence_ref_paths(child, path)
    elif isinstance(value, list):
        for index, child in enumerate(value): yield from _walk_evidence_ref_paths(child, f"{prefix}.{index}")
