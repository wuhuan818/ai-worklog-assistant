"""Owned packaged-backend lifecycle helpers for offline verification scripts.

Each caller owns exactly the ``Popen`` instance it creates.  Cleanup never
searches for or terminates other processes merely because they share an EXE
path.  The backend watchdog is also given the verifier PID, so an interrupted
verifier cannot leave an independently running backend behind.
"""
from __future__ import annotations

import json
import os
import subprocess
import time
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Mapping


@dataclass
class StopResult:
    pid: int
    outcome: str  # already-exited | graceful | terminate | kill


def start_owned_backend(executable: Path, *, environment: Mapping[str, str], cwd=None) -> subprocess.Popen:
    """Start one backend and bind its watchdog to this verifier process."""
    env = dict(environment)
    env["WORKLOG_EXTENSION_HOST_PID"] = str(os.getpid())
    return subprocess.Popen(
        [str(executable)], cwd=str(cwd) if cwd else None, env=env,
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )


def _wait(process: subprocess.Popen, seconds: float) -> bool:
    try:
        process.wait(timeout=seconds)
        return True
    except subprocess.TimeoutExpired:
        return False


def stop_owned_backend(process: subprocess.Popen, *, port: int, token: str, graceful_timeout: float = 5.0, terminate_timeout: float = 5.0) -> StopResult:
    """Stop precisely ``process`` and report the mechanism that succeeded."""
    if process.poll() is not None:
        return StopResult(process.pid, "already-exited")
    try:
        request = urllib.request.Request(
            f"http://127.0.0.1:{port}/runtime/shutdown",
            data=b'{"generation":0}', method="POST",
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        )
        with urllib.request.urlopen(request, timeout=2) as response:
            json.loads(response.read().decode("utf-8"))
    except Exception:
        # A failed graceful request is expected in negative-path tests; the
        # verifier still owns and must clean up its exact child below.
        pass
    if _wait(process, graceful_timeout):
        return StopResult(process.pid, "graceful")
    process.terminate()
    if _wait(process, terminate_timeout):
        return StopResult(process.pid, "terminate")
    process.kill()
    if not _wait(process, terminate_timeout):
        raise RuntimeError(f"owned backend PID {process.pid} did not exit after kill")
    return StopResult(process.pid, "kill")


def assert_owned_backend_exited(process: subprocess.Popen) -> None:
    if process.poll() is None:
        raise AssertionError(f"owned backend PID {process.pid} is still running")
