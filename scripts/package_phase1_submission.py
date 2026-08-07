"""Create a clean, reproducible Phase 1 source archive from Git-tracked files.

The archive intentionally contains source and build configuration only.  The
installable VSIX is the release artifact that carries the packaged backend.
"""

from __future__ import annotations

import argparse
import fnmatch
import hashlib
import json
import re
import subprocess
import sys
import zipfile
from pathlib import Path, PurePosixPath


ROOT = Path(__file__).resolve().parents[1]
ARCHIVE_ROOT = "AI-Worklog-Assistant-Source"
DEFAULT_NAME = "AI-Worklog-Assistant-Source.zip"
EXCLUDED_NAMES = {".env", ".env.local", ".env.production", ".env.development"}
EXCLUDED_GLOBS = (
    ".git/**", "node_modules/**", ".venv/**", "venv/**", "env/**",
    "__pycache__/**", "*.pyc", ".pytest_cache/**", "coverage/**", "temp/**", "tmp/**",
    "artifacts/build/**", "*.db", "*.sqlite", "*.sqlite3", "*.log", "*.vsix",
    "*.zip", ".vscode-test/**", ".idea/**", ".DS_Store", "Thumbs.db",
)
SECRET_TOKEN = re.compile(r"\b(?:sk|ds|rk)-[A-Za-z0-9_-]{20,}\b")
# Deliberately target the actual account used for this submission.  Generic
# paths in privacy test fixtures (for example C:\\Users\\synthetic-user) are
# source code, not a leak of the submitter's environment.
LOCAL_PATH = re.compile(r"(?i)(?:C:\\Users\\86158\\|D:\\desktop\\)")


def tracked_files() -> list[PurePosixPath]:
    result = subprocess.run(
        ["git", "ls-files", "-z"], cwd=ROOT, check=True, capture_output=True
    )
    return [PurePosixPath(value.decode("utf-8")) for value in result.stdout.split(b"\0") if value]


def excluded(path: PurePosixPath) -> bool:
    value = path.as_posix()
    return path.name in EXCLUDED_NAMES or any(fnmatch.fnmatch(value, pattern) for pattern in EXCLUDED_GLOBS)


def audit(path: Path, relative: PurePosixPath) -> list[str]:
    try:
        content = path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        return []
    findings: list[str] = []
    if SECRET_TOKEN.search(content):
        findings.append(f"possible API token: {relative}")
    if LOCAL_PATH.search(content):
        findings.append(f"local absolute path: {relative}")
    return findings


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--filename", default=DEFAULT_NAME)
    args = parser.parse_args()
    if Path(args.filename).name != args.filename or not args.filename.endswith(".zip"):
        raise SystemExit("--filename must be a simple .zip filename")

    files = [path for path in tracked_files() if not excluded(path)]
    findings = [finding for relative in files for finding in audit(ROOT / relative, relative)]
    if findings:
        print("Submission audit failed:", *findings, sep="\n- ", file=sys.stderr)
        return 1

    output_dir = args.output_dir.resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    output = output_dir / args.filename
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for relative in files:
            source = ROOT / relative
            info = zipfile.ZipInfo(f"{ARCHIVE_ROOT}/{relative.as_posix()}")
            info.date_time = (2026, 1, 1, 0, 0, 0)
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            archive.writestr(info, source.read_bytes(), compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)

    with zipfile.ZipFile(output) as archive:
        names = archive.namelist()
    print(json.dumps({"archive": str(output), "file_count": len(names), "size_bytes": output.stat().st_size, "sha256": sha256(output)}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
