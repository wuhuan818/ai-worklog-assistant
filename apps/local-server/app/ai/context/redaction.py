"""Offline deterministic secret redaction for persisted worklog text."""
from __future__ import annotations

import re
from collections import Counter
from typing import Dict, Iterable, List, Pattern, Tuple

REDACTED = re.compile(r"<redacted:[a-z-]+>", re.I)
PROTECTED = re.compile(r"<(?:redacted:[a-z-]+|command-truncated|diff-truncated)>", re.I)
LEGACY_REDACTED = re.compile(r"\[REDACTED\]", re.I)

# Ordered from structured/multiline forms to broad key=value fallbacks.
_SECRET_VALUE = r'(?:"[^"]*"|\'[^\']*\'|[^\s,;\'"\r\n]+)'
_TOKEN_VALUE = r'[A-Za-z0-9._~+/=-]{8,}'
_RULES = (
    ("private-key", re.compile(r"-----BEGIN (?:[A-Z ]*PRIVATE KEY|OPENSSH PRIVATE KEY)-----.*?-----END (?:[A-Z ]*PRIVATE KEY|OPENSSH PRIVATE KEY)-----", re.I | re.S)),
    ("bearer-token", re.compile(r"(?i)(\b(?:proxy-?authorization|authorization)\s*:\s*bearer\s+)" + _TOKEN_VALUE)),
    ("bearer-token", re.compile(r"(?i)\bbearer\s+" + _TOKEN_VALUE)),
    ("credential", re.compile(r"(?i)(\b(?:proxy-?authorization|authorization)\s*:\s*basic\s+)[A-Za-z0-9+/=_-]+")),
    ("cookie", re.compile(r"(?i)(\b(?:set-?cookie|cookie)\s*[:=]\s*)[^\r\n\'\"]+")),
    ("credential", re.compile(r"\b(?:https?|postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis)://[^\s/@:]+:[^\s/@]+@[^\s/]+", re.I)),
    ("api-key", re.compile(r"\b(?:sk-[A-Za-z0-9_-]{12,}|ds-[A-Za-z0-9_-]{12,}|AIza[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9_]{16,}|glpat-[A-Za-z0-9_-]{12,}|AKIA[0-9A-Z]{16})\b")),
    ("jwt", re.compile(r"\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\b")),
    ("password", re.compile(r"(?i)(\bsshpass\b\s*(?:=|:)\s*)" + _SECRET_VALUE)),
    ("password", re.compile(r"(?i)(\b(?:(?:[a-z0-9]+[_-])*(?:password|passwd|pwd)|pgpassword)\b\s*(?:=|:|\s)\s*)" + _SECRET_VALUE)),
    ("api-key", re.compile(r"(?i)(\b(?:(?:[a-z0-9]+[_-])*(?:api[_-]?key|access[_-]?key)|aws[_-]?secret(?:[_-]?access[_-]?key)?)\b\s*(?:=|:|\s)\s*)" + _SECRET_VALUE)),
    ("bearer-token", re.compile(r"(?i)((?<![a-z0-9])_?auth[_-]?token\b\s*(?:=|:|\s)\s*)" + _SECRET_VALUE)),
    ("bearer-token", re.compile(r"(?i)(\b(?:[a-z0-9]+[_-])*(?:token|session[_-]?id|webhook[_-]?secret)\b\s*(?:=|:|\s)\s*)" + _SECRET_VALUE)),
    ("credential", re.compile(r"(?i)(\b(?:[a-z0-9]+[_-])*(?:secret|client[_-]?secret|secret[_-]?(?:key|value))\b\s*(?:=|:|\s)\s*)" + _SECRET_VALUE)),
    ("password", re.compile(r"(?i)(--(?:password|passwd)(?:=|\s+))" + _SECRET_VALUE)),
    ("bearer-token", re.compile(r"(?i)(--(?:token|api-key)(?:=|\s+))" + _SECRET_VALUE)),
)

# These patterns are intentionally restricted to the terminal-command path.
# They are bounded and never scan a 245 KB source diff with command-specific
# look-ahead/backtracking.
_COMMAND_PREFIX_PARTS = (
    # `env FOO=x ...` is represented by two independently consumed parts:
    # the wrapper, followed by the existing assignment part below.
    r"(?i:env|nohup)\s+",
    r"(?i:sudo)(?:\s+(?i:-u|--user)(?:=|\s+)\S+)?\s+",
    r"(?i:time)(?:\s+-p)?\s+",
    r"(?i:nice)(?:\s+(?:-n(?:=|\s+)?[+-]?\d+|-[+-]?\d+))?\s+",
    r"(?i:command)(?:\s+--)?\s+",
    r"[A-Za-z_][A-Za-z0-9_]*=\S+\s+",
)
_COMMAND_PREFIX = r"^\s*(?:(?:" + "|".join(_COMMAND_PREFIX_PARTS) + r"))*"
_WRAPPER_PREFIX = r"^\s*(?i:(?:cmd|powershell|pwsh|wsl|bash|sh)(?:\.exe)?)\b"


def _invoked_executable(name: str, required_after: str = "") -> Pattern[str]:
    binary = r"(?i:" + re.escape(name) + r")(?:\.exe)?"
    direct = r"(?:\"(?:[^\"]*[\\/])?" + binary + r"\"|'(?:[^']*[\\/])?" + binary + r"'|(?:[^\s\"']*[\\/])?" + binary + r")"
    # Known shell wrappers carry a nested command string.  Search only after a
    # wrapper at the start of the segment; this covers cmd/PowerShell/pwsh/WSL
    # without treating `echo curl ...` or a source-code comment as execution.
    wrapped = _WRAPPER_PREFIX + r"[^\r\n]{0,8192}?\b" + binary + r"\b"
    return re.compile(r"(?:" + _COMMAND_PREFIX + direct + required_after + r"|" + wrapped + required_after + r")")


_TERMINAL_COMMAND_RULES = (
    (_invoked_executable("sshpass"), (
        ("password", re.compile(r"((?<!\S)-p(?:=|\s+)?)" + _SECRET_VALUE)),
    )),
    (_invoked_executable("mysql"), (
        # mysql -pPASSWORD is secret-bearing.  Spaced `-p database` prompts
        # for a password and names a database; uppercase -P is the port flag.
        ("password", re.compile(r"((?<!\S)-p=?)" + _SECRET_VALUE)),
    )),
    (_invoked_executable("docker", r"\s+login\b"), (
        ("password", re.compile(r"((?<!\S)-p(?:=|\s+)?)" + _SECRET_VALUE)),
    )),
    (_invoked_executable("curl"), (
        # curl short flags are case-sensitive: -u is origin credentials and
        # -U is proxy credentials.  Both attached/separated forms are valid.
        ("credential", re.compile(r"((?<!\S)(?:-[uU](?:=|\s*)?|(?i:--(?:user|proxy-user))(?:=|\s+)))" + _SECRET_VALUE)),
    )),
)


def _split_protected(text: str) -> List[Tuple[str, bool]]:
    segments: List[Tuple[str, bool]] = []
    offset = 0
    for match in PROTECTED.finditer(text):
        if match.start() > offset: segments.append((text[offset:match.start()], False))
        segments.append((match.group(0), True))
        offset = match.end()
    if offset < len(text): segments.append((text[offset:], False))
    return segments or [("", False)]


def _apply_rules(text: str, rules: Iterable[Tuple[str, Pattern[str]]], counts: Counter) -> str:
    segments = _split_protected(text)
    for category, rule in rules:
        updated: List[Tuple[str, bool]] = []
        for segment, protected in segments:
            if protected:
                updated.append((segment, True))
                continue
            def replace(match: re.Match, category: str = category) -> str:
                counts[category] += 1
                return (match.group(1) if match.lastindex else "") + "<redacted:{}>".format(category)
            updated.extend(_split_protected(rule.sub(replace, segment)))
        segments = updated
    return "".join(segment for segment, _ in segments)


def _split_shell_segments(text: str) -> List[Tuple[str, bool]]:
    """Split on unquoted shell separators while preserving exact text."""
    result: List[Tuple[str, bool]] = []
    start = 0
    index = 0
    quote = ""
    escaped = False
    while index < len(text):
        character = text[index]
        if escaped:
            escaped = False
        elif character in {'\\', '`'} and quote != "'":
            escaped = True
        elif quote:
            if character == quote: quote = ""
        elif character in {'\'', '"'}:
            quote = character
        elif character in {';', '&', '|'}:
            if index > start: result.append((text[start:index], True))
            end = index + 1
            while end < len(text) and text[end] in {';', '&', '|'}: end += 1
            result.append((text[index:end], False))
            start = end
            index = end - 1
        index += 1
    if start < len(text): result.append((text[start:], True))
    return result or [("", True)]


def redact_text(value: object) -> Tuple[str, Dict[str, int]]:
    """Return text with secret values replaced by stable category placeholders.

    Existing placeholders are deliberately not counted or changed, making this
    operation idempotent. UUIDs and SHA hashes do not match any rule.
    """
    text = str(value if value is not None else "")
    counts: Counter[str] = Counter()
    # Earlier event capture versions stored this generic marker.  Normalize it
    # into the v1 stable category without ever restoring the original value.
    text, legacy_count = LEGACY_REDACTED.subn("<redacted:credential>", text)
    if legacy_count:
        counts["credential"] += legacy_count
    return _apply_rules(text, _RULES, counts), dict(sorted(counts.items()))


def redact_terminal_command(value: object) -> Tuple[str, Dict[str, int]]:
    """Apply generic redaction plus bounded command-line flag protection."""
    text, found = redact_text(value)
    counts = Counter(found)
    pieces: List[str] = []
    for segment, is_command in _split_shell_segments(text):
        if is_command:
            for executable, rules in _TERMINAL_COMMAND_RULES:
                match = executable.search(segment)
                if match:
                    segment = segment[:match.end()] + _apply_rules(segment[match.end():], rules, counts)
        pieces.append(segment)
    return "".join(pieces), dict(sorted(counts.items()))
