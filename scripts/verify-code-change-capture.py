"""Deterministic packaged-backend verification for Stage 12A code diffs."""
from __future__ import annotations

import argparse
import json
import os
import random
import shutil
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

from backend_lifecycle import assert_owned_backend_exited, start_owned_backend, stop_owned_backend


PATCH = """--- a/src/hello.cpp
+++ b/src/hello.cpp
@@ -1,1 +1,1 @@
-std::cout << greet(userName) << std::endl;
+std::cout << greet(\"World\") << std::endl;"""


def request(port: int, path: str, token: str, method: str = "GET", body=None):
    data = None if body is None else json.dumps(body).encode("utf-8")
    headers = {"Authorization": "Bearer " + token}
    if data is not None:
        headers["Content-Type"] = "application/json"
    message = urllib.request.Request(f"http://127.0.0.1:{port}{path}", data=data, headers=headers, method=method)
    with urllib.request.urlopen(message, timeout=3) as response:
        return json.loads(response.read().decode("utf-8"))


def wait_for_health(port: int, process) -> None:
    for _ in range(60):
        try:
            health = request(port, "/health", "stage12-token")
            if health.get("status") == "ok" and "code-change-capture-v2" in health.get("features", []):
                return
        except Exception:
            if process.poll() is not None:
                raise RuntimeError("packaged backend exited before health")
        time.sleep(0.2)
    raise RuntimeError("packaged backend did not become healthy")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--executable", required=True)
    parser.add_argument("--port", type=int, default=random.randint(30000, 38000))
    args = parser.parse_args()
    executable = Path(args.executable).resolve()
    if not executable.is_file():
        raise RuntimeError(f"missing executable: {executable}")
    data_dir = Path(tempfile.mkdtemp(prefix="ai-worklog-stage12-"))
    token = "stage12-token"
    environment = os.environ.copy()
    environment.update({"WORKLOG_DATA_DIR": str(data_dir), "WORKLOG_SESSION_TOKEN": token, "WORKLOG_PORT": str(args.port)})
    first = second = None
    try:
        first = start_owned_backend(executable, environment=environment)
        wait_for_health(args.port, first)
        project = request(args.port, "/projects", token, "POST", {"name": "Stage 12 verifier"})
        task = request(args.port, "/tasks", token, "POST", {"name": "Capture C++ diff", "project_id": project["id"]})
        event = {
            "client_event_id": "stage12-cpp-diff",
            "event_type": "code_diff",
            "source": "stage12-verifier",
            "workspace_path": "C:/stage12-workspace",
            "file_path": "src/hello.cpp",
            "occurred_at": "2026-08-09T00:00:00Z",
            "payload": {
                "language_id": "cpp", "patch": PATCH, "added_lines": 1, "removed_lines": 1,
                "changed_ranges": [{"before_start_line": 1, "before_line_count": 1, "after_start_line": 1, "after_line_count": 1}],
                "original_patch_bytes": len(PATCH.encode("utf-8")), "retained_patch_bytes": len(PATCH.encode("utf-8")),
                "patch_truncated": False, "capture_mode": "save-time-snapshot",
            },
        }
        batch = request(args.port, f"/tasks/{task['id']}/events/batch", token, "POST", {"events": [event]})
        event_id = batch["event_ids"][0]
        request(args.port, f"/tasks/{task['id']}/end", token, "POST")
        package = request(args.port, f"/tasks/{task['id']}/ai/context-packages", token, "POST", {"config": {"estimated_input_token_budget": 32000}})
        context = package["context"]
        code_diffs = context.get("code_diffs", [])
        if len(code_diffs) != 1 or code_diffs[0].get("patch") != PATCH:
            raise RuntimeError("Context package did not retain the C++ diff")
        expected_ref = {"type": "code_diff", "id": event_id}
        if expected_ref not in context.get("provenance", {}).get("included_source_refs", []):
            raise RuntimeError("Context package did not expose code_diff evidence")
        stop_owned_backend(first, port=args.port, token=token)
        assert_owned_backend_exited(first)
        first = None
        second = start_owned_backend(executable, environment=environment)
        wait_for_health(args.port, second)
        recovered = request(args.port, f"/ai/context-packages/{package['id']}", token)
        if recovered.get("context", {}).get("code_diffs", [{}])[0].get("patch") != PATCH:
            raise RuntimeError("restart did not recover persisted code diff")
        print("STAGE12_PACKAGED_CODE_DIFF=PASS")
        print("CODE_DIFF_CONTEXT=PASS")
        print("CODE_DIFF_EVIDENCE=PASS")
        print("RESTART_RECOVERY=PASS")
    finally:
        for process in (first, second):
            if process is not None:
                stop_owned_backend(process, port=args.port, token=token)
                assert_owned_backend_exited(process)
        shutil.rmtree(str(data_dir), ignore_errors=True)
    print("OWNED_BACKEND_CLEANUP=PASS")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"STAGE12_PACKAGED_CODE_DIFF=FAIL: {error}", file=sys.stderr)
        sys.exit(1)
