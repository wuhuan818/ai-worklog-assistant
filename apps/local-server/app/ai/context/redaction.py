"""Offline deterministic secret redaction for persisted worklog text."""
from __future__ import annotations

import re
from collections import Counter
from typing import Dict, Tuple

REDACTED = re.compile(r"<redacted:[a-z-]+>", re.I)
LEGACY_REDACTED = re.compile(r"\[REDACTED\]", re.I)

# Ordered from structured/multiline forms to broad key=value fallbacks.
_RULES = (
    ("private-key", re.compile(r"-----BEGIN (?:[A-Z ]*PRIVATE KEY|OPENSSH PRIVATE KEY)-----.*?-----END (?:[A-Z ]*PRIVATE KEY|OPENSSH PRIVATE KEY)-----", re.I | re.S)),
    ("bearer-token", re.compile(r"\b(?:proxy-?authorization|authorization)\s*:\s*bearer\s+[^\s,;]+|\bbearer\s+[A-Za-z0-9._~+/=-]{8,}", re.I)),
    ("credential", re.compile(r"\b(?:proxy-?authorization|authorization)\s*:\s*basic\s+[^\s,;]+", re.I)),
    ("cookie", re.compile(r"\b(?:set-?cookie|cookie)\s*[:=]\s*[^\r\n]+", re.I)),
    ("credential", re.compile(r"\b(?:https?|postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis)://[^\s/@:]+:[^\s/@]+@[^\s/]+", re.I)),
    ("api-key", re.compile(r"\b(?:sk-[A-Za-z0-9_-]{12,}|ds-[A-Za-z0-9_-]{12,}|AIza[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9_]{16,}|glpat-[A-Za-z0-9_-]{12,}|AKIA[0-9A-Z]{16})\b")),
    ("jwt", re.compile(r"\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\b")),
    ("password", re.compile(r"(?i)(\b(?:password|passwd|pwd)\b\s*(?:=|:|\s)\s*)(?:\"[^\"]*\"|'[^']*'|[^\s,;\r\n]+)")),
    ("api-key", re.compile(r"(?i)(\b(?:api[_-]?key|access[_-]?key|aws[_-]?secret(?:[_-]?access[_-]?key)?)\b\s*(?:=|:|\s)\s*)(?:\"[^\"]*\"|'[^']*'|[^\s,;\r\n]+)")),
    ("bearer-token", re.compile(r"(?i)(\b(?:token|session[_-]?id|webhook[_-]?secret)\b\s*(?:=|:|\s)\s*)(?:\"[^\"]*\"|'[^']*'|[^\s,;\r\n]+)")),
    ("credential", re.compile(r"(?i)(\b(?:secret|client[_-]?secret)\b\s*(?:=|:|\s)\s*)(?:\"[^\"]*\"|'[^']*'|[^\s,;\r\n]+)")),
    ("password", re.compile(r"(?i)(--(?:password|passwd)(?:=|\s+))(?:\"[^\"]*\"|'[^']*'|\S+)")),
    ("bearer-token", re.compile(r"(?i)(--(?:token|api-key)(?:=|\s+))(?:\"[^\"]*\"|'[^']*'|\S+)")),
)


def redact_text(value: object) -> Tuple[str, Dict[str, int]]:
    """Return text with secret values replaced by stable category placeholders.

    Existing placeholders are deliberately not counted or changed, making this
    operation idempotent. UUIDs and SHA hashes do not match any rule.
    """
    text = str(value if value is not None else "")
    counts: Counter[str] = Counter()
    protected = {}
    def protect(match: re.Match) -> str:
        token = "\x00R{}\x00".format(len(protected))
        protected[token] = match.group(0)
        return token
    text = REDACTED.sub(protect, text)
    # Earlier event capture versions stored this generic marker.  Normalize it
    # into the v1 stable category without ever restoring the original value.
    text, legacy_count = LEGACY_REDACTED.subn("<redacted:credential>", text)
    if legacy_count:
        counts["credential"] += legacy_count
    for category, rule in _RULES:
        def replace(match: re.Match, category: str = category) -> str:
            counts[category] += 1
            # Rules with a capturing prefix retain the harmless key/flag.
            return (match.group(1) if match.lastindex else "") + "<redacted:{}>".format(category)
        text = rule.sub(replace, text)
    for token, original in protected.items():
        text = text.replace(token, original)
    return text, dict(sorted(counts.items()))
