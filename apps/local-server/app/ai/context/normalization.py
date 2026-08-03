"""Deterministic, privacy-safe normalization primitives.

These functions never inspect the file system.  Paths are normalized only from
the values already recorded by the worklog.
"""
from __future__ import annotations

import json
import ntpath
import os
import re
from typing import Any, Iterable, Mapping, Optional, Tuple

_ABSOLUTE = re.compile(r"^(?:[a-zA-Z]:[\\/]|/|\\\\)")


def stable_json(value: Any) -> str:
    """Return canonical JSON suitable for deterministic hashes and comparisons."""
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)


def normalize_text(value: Any) -> str:
    """Normalize line endings without changing meaningful text."""
    return str(value if value is not None else "").replace("\r\n", "\n").replace("\r", "\n")


def _root_items(workspace_roots: Optional[object]) -> Iterable[Tuple[str, str]]:
    if isinstance(workspace_roots, Mapping):
        for name, root in workspace_roots.items():
            yield str(name), str(root)
    elif workspace_roots:
        for root in workspace_roots:  # type: ignore[union-attr]
            if isinstance(root, Mapping):
                path = root.get("path") or root.get("fsPath") or root.get("uri") or ""
                name = root.get("name") or ntpath.basename(str(path).rstrip("\\/"))
                yield str(name), str(path)
            else:
                value = str(root)
                yield ntpath.basename(value.rstrip("\\/")), value


def _windows(path: str) -> str:
    # Recorded paths occasionally contain doubled separators.  Collapse them
    # after preserving a UNC prefix, so equivalent paths compare consistently.
    value = path.replace("/", "\\")
    prefix = "\\\\" if value.startswith("\\\\") else ""
    value = re.sub(r"\\+", r"\\", value[len(prefix):])
    return prefix + value.rstrip("\\")


def normalize_path(path: Optional[str], workspace_roots: Optional[object] = None) -> str:
    """Remove absolute user paths, preserving a useful deterministic identifier.

    A single root emits ``src/file.py``.  A multi-root workspace emits
    ``<root-name>/src/file.py``.  Any absolute non-workspace path is reduced to
    ``<external-path>/basename`` and consequently cannot disclose another root.
    """
    raw = str(path or "").strip()
    if not raw:
        return ""
    candidate = _windows(raw)
    roots = list(_root_items(workspace_roots))
    matches = []
    folded = candidate.casefold()
    for name, root in roots:
        root_path = _windows(root)
        if root_path and (folded == root_path.casefold() or folded.startswith(root_path.casefold() + "\\")):
            relative = candidate[len(root_path):].lstrip("\\").replace("\\", "/")
            matches.append((name, relative))
    if matches:
        name, relative = sorted(matches, key=lambda x: (-len(x[1]), x[0].casefold()))[0]
        return relative if len(roots) <= 1 else "{}/{}".format(name, relative).rstrip("/")
    if _ABSOLUTE.match(raw):
        base = ntpath.basename(candidate) or "path"
        return "<external-path>/{}".format(base)
    return candidate.lstrip("\\/").replace("\\", "/")


def is_absolute_path(path: Optional[str]) -> bool:
    return bool(_ABSOLUTE.match(str(path or "")))


_SENSITIVE_NAMES = (
    re.compile(r"^\.env(?:\..+)?$", re.I), re.compile(r"^id_rsa(?:\..+)?$", re.I),
    re.compile(r"^id_ed25519(?:\..+)?$", re.I), re.compile(r"^credentials.*$", re.I),
    re.compile(r"^secrets.*$", re.I), re.compile(r"^.*secret.*$", re.I),
)
_SENSITIVE_SUFFIXES = (".pem", ".key", ".pfx", ".p12", ".keystore", ".jks")
_SENSITIVE_EXACT = {".npmrc", ".pypirc", ".netrc", "docker-config.json"}


def sensitive_file_category(path: Optional[str]) -> Optional[str]:
    """Classify names whose body/diff must never enter a context package."""
    name = ntpath.basename(str(path or "").replace("/", "\\")).casefold()
    if name in _SENSITIVE_EXACT or name.endswith(_SENSITIVE_SUFFIXES) or any(p.match(name) for p in _SENSITIVE_NAMES):
        return "credential-file"
    return None


def is_sensitive_file(path: Optional[str]) -> bool:
    return sensitive_file_category(path) is not None
