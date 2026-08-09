"""Deterministic local token estimates and context-package budget trimming."""
from __future__ import annotations

import copy
import math
import re
from collections import Counter
from typing import Any, Dict, Iterable, List, MutableMapping, Tuple

from .normalization import sensitive_file_category, stable_json

DIFF_MAX_CHARACTERS = 8000
DIFF_MAX_LINES = 200
DIFF_MAX_FILES = 30
DIFF_BUDGET_FRACTION = 0.35


class BudgetError(ValueError):
    """Raised when the irreducible package cannot fit the requested budget."""
    code = "minimum_context_exceeds_budget"


def estimate_tokens(text: object) -> int:
    """Conservative deterministic estimate: CJK=1 each, ASCII=4/token, others=2/token.

    Whitespace is included in its ASCII group, intentionally avoiding any model
    tokenizer or network dependency.
    """
    ascii_chars = cjk_chars = other_chars = 0
    for char in str(text if text is not None else ""):
        point = ord(char)
        if char.isascii():
            ascii_chars += 1
        elif (0x3400 <= point <= 0x4DBF or 0x4E00 <= point <= 0x9FFF or
              0x3040 <= point <= 0x30FF or 0xAC00 <= point <= 0xD7AF):
            cjk_chars += 1
        else:
            other_chars += 1
    return int(math.ceil(ascii_chars / 4.0) + cjk_chars + math.ceil(other_chars / 2.0))


def _content(package: MutableMapping[str, Any]) -> str:
    return stable_json(package)


def _diff_text(item: MutableMapping[str, Any]) -> Tuple[str, str]:
    for key in ("patch", "diff", "content", "text", "snippet", "diff_text"):
        if isinstance(item.get(key), str):
            return key, item[key]
    return "", ""


def _cap_diff(item: MutableMapping[str, Any], char_cap: int = DIFF_MAX_CHARACTERS, line_cap: int = DIFF_MAX_LINES) -> bool:
    key, original = _diff_text(item)
    if not key:
        return False
    lines = original.splitlines()
    retained = "\n".join(lines[:line_cap])
    if len(retained) > char_cap:
        retained = retained[:char_cap]
    truncated = len(retained) < len(original) or len(lines) > line_cap
    item["original_characters"] = len(original)
    item["retained_characters"] = len(retained)
    item["original_lines"] = len(lines)
    item["retained_lines"] = len(retained.splitlines())
    item["truncated"] = truncated
    if truncated:
        marker = "\n<diff-truncated>"
        item[key] = (retained[:max(0, char_cap - len(marker))] + marker)
    return truncated


def _iter_diff_lists(package: MutableMapping[str, Any]) -> Iterable[List[Any]]:
    for key in ("code_diffs", "file_changes", "files", "diffs"):
        value = package.get(key)
        if isinstance(value, list):
            yield value


def _sanitize_diffs(package: MutableMapping[str, Any], report: Counter) -> None:
    seen = 0
    for entries in _iter_diff_lists(package):
        for entry in entries:
            if not isinstance(entry, MutableMapping):
                continue
            if sensitive_file_category(entry.get("path") or entry.get("relative_path")):
                for key in ("diff", "content", "text", "snippet", "diff_text"):
                    entry.pop(key, None)
                entry["sensitive_content_excluded"] = True
                entry["sensitive_category"] = "credential-file"
                report["sensitive-file-diff"] += 1
                continue
            if _diff_text(entry)[0]:
                seen += 1
                if seen > DIFF_MAX_FILES:
                    key, _ = _diff_text(entry)
                    entry.pop(key, None)
                    entry["diff_omitted"] = True
                    report["diff-file-limit"] += 1
                elif _cap_diff(entry):
                    report["diff-per-file-limit"] += 1


def _remove_one(package: MutableMapping[str, Any], key: str) -> bool:
    target: Any = package
    parts = key.split(".")
    for part in parts[:-1]:
        target = target.get(part) if isinstance(target, MutableMapping) else None
    values = target.get(parts[-1]) if isinstance(target, MutableMapping) else None
    if isinstance(values, list) and values:
        values.pop()  # lists must already have stable ordering; trim lowest item last
        return True
    return False


def _shorten_diff_once(package: MutableMapping[str, Any]) -> bool:
    candidates = []
    for entries in _iter_diff_lists(package):
        for entry in entries:
            if isinstance(entry, MutableMapping):
                key, text = _diff_text(entry)
                if key and text:
                    candidates.append((len(text), key, entry))
    if not candidates:
        return False
    _, key, entry = sorted(candidates, key=lambda item: (-item[0], str(item[2].get("path", ""))))[0]
    text = entry[key]
    if len(text) <= 32:
        entry.pop(key, None)
        entry["diff_omitted"] = True
    else:
        new_size = max(32, len(text) // 2)
        entry[key] = text[:new_size] + "\n<diff-truncated>"
        entry["truncated"] = True
        entry["retained_characters"] = len(entry[key])
    return True


def _set_report(package: MutableMapping[str, Any], budget: int, before_chars: int, before_tokens: int, truncations: Counter, omissions: Counter) -> Tuple[int, int]:
    report = {
        "estimated_token_budget": budget,
        "estimated_tokens_before": before_tokens,
        "estimated_tokens_after": 0,
        "characters_before": before_chars,
        "characters_after": 0,
        "truncated": bool(truncations or omissions),
        "truncation_categories": dict(sorted(truncations.items())),
        "omitted_item_counts": dict(sorted(omissions.items())),
    }
    package["budget"] = report
    content = _content(package)
    report["characters_after"] = len(content)
    report["estimated_tokens_after"] = estimate_tokens(content)
    return report["characters_after"], report["estimated_tokens_after"]


def apply_budget(package: Dict[str, Any], budget: int) -> Dict[str, Any]:
    """Return a copied package trimmed predictably to an estimated token budget.

    The fixed core is never removed.  Optional sections are removed in reverse
    priority order; entries are removed from the end so stable ordering remains
    meaningful.  The supplied input is never mutated.
    """
    if not isinstance(budget, int) or budget <= 0:
        raise ValueError("invalid_budget")
    result: Dict[str, Any] = copy.deepcopy(package)
    result.pop("budget", None)
    before = _content(result)
    before_chars, before_tokens = len(before), estimate_tokens(before)
    truncations: Counter = Counter()
    omissions: Counter = Counter()
    _sanitize_diffs(result, truncations)
    # First enforce the aggregate diff allocation.  This is independent of
    # optional-section pruning and prevents diffs from consuming the package.
    diff_cap = max(1, int(budget * DIFF_BUDGET_FRACTION))
    while sum(estimate_tokens(_diff_text(e)[1]) for entries in _iter_diff_lists(result) for e in entries if isinstance(e, MutableMapping)) > diff_cap:
        if not _shorten_diff_once(result):
            break
        truncations["diff-budget-limit"] += 1
    _, current = _set_report(result, budget, before_chars, before_tokens, truncations, omissions)
    # Lowest to highest priority (the task core and reports are intentionally absent).
    sections = ("debug_events", "commands_and_tasks", "commands", "tasks", "diffs", "code_diffs", "file_changes", "files",
                "diagnostics", "bug_notes", "bugs", "manual_notes", "task.manual_notes")
    while current > budget:
        progressed = False
        for key in sections:
            if key in ("diffs", "code_diffs", "file_changes", "files") and _shorten_diff_once(result):
                truncations["diff-budget-limit"] += 1
                progressed = True
            elif _remove_one(result, key):
                omissions[key] += 1
                progressed = True
            if progressed:
                break
        if not progressed:
            raise BudgetError("minimum_context_exceeds_budget")
        _, current = _set_report(result, budget, before_chars, before_tokens, truncations, omissions)
    return result
