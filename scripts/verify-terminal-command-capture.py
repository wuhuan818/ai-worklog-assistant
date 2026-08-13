"""Deterministic packaged-backend verification for Stage 12B terminal commands.

The command values below are inert test data.  This verifier never executes a
terminal command and the capture contract explicitly declares that no output
was collected.
"""
from __future__ import annotations

import argparse
import json
import os
import random
import re
import shutil
import sqlite3
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path

from backend_lifecycle import assert_owned_backend_exited, start_owned_backend, stop_owned_backend


FEATURE = "terminal-command-capture-v1"
TOKEN = "stage12b-token"
SECRET = "super-secret-token-123456"
REDACTED_SECRET = "<redacted:bearer-token>"
PLAIN_COMMAND = "npm.cmd test"
SECRET_COMMAND = f'curl.exe -H "Authorization: Bearer {SECRET}" https://example.test'
EXPANDING_COMMAND = ("A_TOKEN=x " * 700).strip()
RAW_OUTPUT_SENTINEL = "stage12b-output-must-be-rejected"
REJECTED_OUTPUT_EVENT_ID = "stage12b-terminal-output-rejected"
CONTEXT_COMMAND_FIELDS = {
    "id",
    "event_type",
    "occurred_at",
    "command",
    "confidence",
    "status",
    "exit_code",
    "started_at",
    "duration_ms",
    "original_command_bytes",
    "retained_command_bytes",
    "command_truncated",
    "capture_mode",
    "is_trusted",
    "output_captured",
    "cwd",
    "redaction_count",
    "redaction_categories",
}


def require(condition: bool, message: str) -> None:
    if not condition:
        raise RuntimeError(message)


def require_redacted_command(command: object, location: str) -> None:
    require(isinstance(command, str), f"{location} command is not text")
    require(SECRET not in command, f"{location} retained the Bearer secret")
    require(REDACTED_SECRET in command, f"{location} omitted the stable Bearer placeholder")


def contains_forbidden_capture_field(candidate: object) -> bool:
    if isinstance(candidate, dict):
        for key, item in candidate.items():
            normalized = re.sub(r"(?<!^)(?=[A-Z])", "_", str(key)).lower().replace("-", "_")
            tokens = {token for token in normalized.split("_") if token}
            if normalized != "output_captured" and tokens.intersection(
                {"output", "stdout", "stderr", "environment", "env"}
            ):
                return True
            if contains_forbidden_capture_field(item):
                return True
    elif isinstance(candidate, list):
        return any(contains_forbidden_capture_field(item) for item in candidate)
    return False


def require_no_raw_capture(candidate: object, location: str) -> None:
    require(
        RAW_OUTPUT_SENTINEL not in json.dumps(candidate, ensure_ascii=False),
        f"{location} retained the rejected raw-output sentinel",
    )
    require(not contains_forbidden_capture_field(candidate), f"{location} retained a raw output/environment field")


def require_rebounded_payload(payload: dict, location: str, expect_truncated: bool = False) -> None:
    command = payload.get("command")
    require(isinstance(command, str), f"{location} command is not text")
    retained_bytes = len(command.encode("utf-8"))
    require(retained_bytes <= 8192, f"{location} command exceeds the persisted UTF-8 boundary")
    require(
        payload.get("retained_command_bytes") == retained_bytes,
        f"{location} retained_command_bytes does not match the sanitized command",
    )
    original_bytes = payload.get("original_command_bytes")
    require(
        isinstance(original_bytes, int) and not isinstance(original_bytes, bool) and original_bytes >= retained_bytes,
        f"{location} original_command_bytes is invalid after sanitization",
    )
    if expect_truncated:
        require(payload.get("command_truncated") is True, f"{location} omitted the truncation flag")
        require(original_bytes > retained_bytes, f"{location} did not record the pre-boundary sanitized size")
        require(command.endswith("<command-truncated>"), f"{location} omitted the truncation marker")


def request(port: int, path: str, token: str, method: str = "GET", body=None):
    data = None if body is None else json.dumps(body, ensure_ascii=False).encode("utf-8")
    headers = {"Authorization": "Bearer " + token}
    if data is not None:
        headers["Content-Type"] = "application/json; charset=utf-8"
    message = urllib.request.Request(
        f"http://127.0.0.1:{port}{path}", data=data, headers=headers, method=method
    )
    try:
        with urllib.request.urlopen(message, timeout=5) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"{method} {path} returned HTTP {error.code}: {detail}") from error


def require_http_error(port: int, path: str, token: str, expected_status: int, body: dict) -> None:
    data = json.dumps(body, ensure_ascii=False).encode("utf-8")
    message = urllib.request.Request(
        f"http://127.0.0.1:{port}{path}",
        data=data,
        headers={"Authorization": "Bearer " + token, "Content-Type": "application/json; charset=utf-8"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(message, timeout=5) as response:
            detail = response.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        require(
            error.code == expected_status,
            f"POST {path} returned HTTP {error.code}, expected {expected_status}: {detail}",
        )
        return
    raise RuntimeError(f"POST {path} unexpectedly accepted forbidden capture data: {detail}")


def wait_for_health(port: int, process, token: str) -> None:
    for _ in range(60):
        try:
            health = request(port, "/health", token)
            if health.get("status") == "ok" and FEATURE in health.get("features", []):
                return
        except Exception:
            if process.poll() is not None:
                raise RuntimeError("packaged backend exited before health")
        time.sleep(0.2)
    raise RuntimeError(f"packaged backend did not advertise {FEATURE}")


def terminal_event(client_event_id: str, command: str, occurred_at: str, duration_ms: int) -> dict:
    command_bytes = len(command.encode("utf-8"))
    return {
        "client_event_id": client_event_id,
        "event_type": "terminal_command",
        "source": "stage12b-verifier",
        "workspace_path": "C:/stage12b-workspace",
        "occurred_at": occurred_at,
        "payload": {
            "command": command,
            "confidence": "high",
            "status": "succeeded",
            "exit_code": 0,
            "started_at": "2026-08-09T01:02:03.456Z",
            "duration_ms": duration_ms,
            "original_command_bytes": command_bytes,
            "retained_command_bytes": command_bytes,
            "command_truncated": False,
            "capture_mode": "shell-integration",
            "is_trusted": True,
            "output_captured": False,
            "cwd": "apps/local-server",
        },
    }


def verify_sqlite(data_dir: Path, event_ids: list[str]) -> dict[str, dict]:
    database = data_dir / "worklog.db"
    require(database.is_file(), f"packaged backend did not create {database}")
    connection = sqlite3.connect(str(database))
    connection.row_factory = sqlite3.Row
    try:
        placeholders = ",".join("?" for _ in event_ids)
        rows = connection.execute(
            f"SELECT id,event_type,payload_json FROM worklog_events WHERE id IN ({placeholders})",
            event_ids,
        ).fetchall()
        rejected_count = connection.execute(
            "SELECT COUNT(*) FROM worklog_events WHERE client_event_id=?",
            (REJECTED_OUTPUT_EVENT_ID,),
        ).fetchone()[0]
    finally:
        connection.close()
    require(len(rows) == len(event_ids), "SQLite did not retain every terminal command event")
    stored = {row["id"]: row for row in rows}
    require(all(row["event_type"] == "terminal_command" for row in rows), "SQLite event type mismatch")
    serialized = "\n".join(row["payload_json"] for row in rows)
    require(SECRET not in serialized, "SQLite retained the Bearer secret")
    require(RAW_OUTPUT_SENTINEL not in serialized, "SQLite retained rejected raw output")
    require(rejected_count == 0, "SQLite persisted the rejected raw-output event")
    payloads = {event_id: json.loads(stored[event_id]["payload_json"]) for event_id in event_ids}
    for index, event_id in enumerate(event_ids):
        require_no_raw_capture(payloads[event_id], f"SQLite event {index}")
        require_rebounded_payload(payloads[event_id], f"SQLite event {index}", expect_truncated=index == 2)
        require(payloads[event_id].get("output_captured") is False, "SQLite claims terminal output was captured")
    secret_payload = payloads[event_ids[1]]
    require_redacted_command(secret_payload.get("command"), "SQLite")
    require(secret_payload.get("redaction_count") == 1, "SQLite redaction count was not server-authored")
    require(
        secret_payload.get("redaction_categories") == {"bearer-token": 1},
        "SQLite redaction categories were not server-authored",
    )
    expanded_payload = payloads[event_ids[2]]
    require(expanded_payload.get("redaction_count", 0) > 0, "SQLite omitted expansion-case redactions")
    return payloads


def verify_events_api(port: int, task_id: str, event_ids: list[str], persisted: dict[str, dict]) -> None:
    listing = request(port, f"/tasks/{task_id}/events?event_type=terminal_command", TOKEN)
    require(listing.get("total") == len(event_ids), "events API terminal command count mismatch")
    items = listing.get("items", [])
    require(len(items) == len(event_ids), "events API did not return every terminal command")
    serialized = json.dumps(items, ensure_ascii=False)
    require(SECRET not in serialized, "events API returned the Bearer secret")
    returned = {item.get("id"): item for item in items}
    require(set(returned) == set(event_ids), "events API returned unexpected event IDs")
    for index, event_id in enumerate(event_ids):
        payload = returned[event_id].get("payload", {})
        require(payload == persisted[event_id], f"events API payload {index} differs from SQLite")
        require_no_raw_capture(payload, f"events API event {index}")
        require_rebounded_payload(payload, f"events API event {index}", expect_truncated=index == 2)
        require(payload.get("output_captured") is False, "events API claims terminal output was captured")
    secret_payload = returned[event_ids[1]].get("payload", {})
    require_redacted_command(secret_payload.get("command"), "events API")
    require(secret_payload.get("redaction_count") == 1, "events API redaction count mismatch")
    require(secret_payload.get("redaction_categories") == {"bearer-token": 1}, "events API categories mismatch")


def verify_context(context: dict, event_ids: list[str], persisted: dict[str, dict]) -> None:
    serialized = json.dumps(context, ensure_ascii=False)
    require(SECRET not in serialized, "Context retained the Bearer secret")
    commands = [
        item for item in context.get("commands_and_tasks", [])
        if item.get("event_type") == "terminal_command"
    ]
    require(len(commands) == len(event_ids), "Context terminal command count mismatch")
    by_id = {item.get("id"): item for item in commands}
    require(set(by_id) == set(event_ids), "Context terminal command IDs mismatch")
    for item in commands:
        require(set(item) == CONTEXT_COMMAND_FIELDS, f"Context command whitelist mismatch: {sorted(item)}")
        require(item.get("output_captured") is False, "Context claims terminal output was captured")
        require_no_raw_capture(item, f"Context event {item.get('id')}")
    require(by_id[event_ids[0]].get("command") == PLAIN_COMMAND, "Context changed the plain command")
    require_redacted_command(by_id[event_ids[1]].get("command"), "Context")
    payload_fields = CONTEXT_COMMAND_FIELDS - {"id", "event_type", "occurred_at"}
    for index, event_id in enumerate(event_ids):
        for field in payload_fields:
            require(
                by_id[event_id].get(field) == persisted[event_id].get(field),
                f"Context event {index} changed persisted field {field}",
            )
        require_rebounded_payload(by_id[event_id], f"Context event {index}", expect_truncated=index == 2)
    require(context.get("statistics", {}).get("terminal_commands") == len(event_ids), "Context statistics mismatch")
    privacy = context.get("privacy", {})
    expected_redactions = sum(payload.get("redaction_count", 0) for payload in persisted.values())
    require(
        privacy.get("persisted_redaction_count") == expected_redactions,
        "Context persisted redaction count mismatch",
    )
    require(privacy.get("redaction_count", 0) >= 1, "Context did not report command redaction")
    require(privacy.get("redaction_categories", {}).get("bearer-token", 0) >= 1, "Context omitted Bearer category")
    require(privacy.get("raw_secret_retained") is False, "Context privacy contract reports a retained secret")
    refs = context.get("provenance", {}).get("included_source_refs", [])
    require(all(set(ref) == {"type", "id"} for ref in refs), "Context Evidence ref shape is not whitelisted")
    observed_refs = {(ref.get("type"), ref.get("id")) for ref in refs}
    expected_refs = {("terminal_command", event_id) for event_id in event_ids}
    require(observed_refs == expected_refs and len(refs) == len(expected_refs), "Context Evidence whitelist mismatch")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--executable", required=True)
    parser.add_argument("--port", type=int, default=random.randint(30000, 38000))
    args = parser.parse_args()
    executable = Path(args.executable).resolve()
    require(executable.is_file(), f"missing executable: {executable}")

    data_dir = Path(tempfile.mkdtemp(prefix="ai-worklog-stage12b-"))
    environment = os.environ.copy()
    environment.update(
        {
            "WORKLOG_DATA_DIR": str(data_dir),
            "WORKLOG_SESSION_TOKEN": TOKEN,
            "WORKLOG_PORT": str(args.port),
        }
    )
    first = second = None
    owned_processes = []
    try:
        first = start_owned_backend(executable, environment=environment)
        owned_processes.append(first)
        wait_for_health(args.port, first, TOKEN)
        print("TERMINAL_CAPTURE_FEATURE=PASS")

        project = request(args.port, "/projects", TOKEN, "POST", {"name": "Stage 12B verifier"})
        task = request(
            args.port,
            "/tasks",
            TOKEN,
            "POST",
            {"name": "Capture terminal commands", "project_id": project["id"]},
        )
        events = [
            terminal_event("stage12b-terminal-plain", PLAIN_COMMAND, "2026-08-09T01:02:04Z", 321),
            terminal_event("stage12b-terminal-secret", SECRET_COMMAND, "2026-08-09T01:02:05Z", 654),
            terminal_event("stage12b-terminal-expanded", EXPANDING_COMMAND, "2026-08-09T01:02:06Z", 987),
        ]
        batch = request(
            args.port,
            f"/tasks/{task['id']}/events/batch",
            TOKEN,
            "POST",
            {"events": events},
        )
        event_ids = batch.get("event_ids", [])
        require(batch.get("inserted") == 3 and batch.get("duplicates") == 0, "batch insert result mismatch")
        require(len(event_ids) == 3, "batch insert did not return three event IDs")

        rejected_output = terminal_event(
            REJECTED_OUTPUT_EVENT_ID,
            "echo inert-output-negative-test",
            "2026-08-09T01:02:07Z",
            1,
        )
        rejected_output["payload"]["stdout"] = RAW_OUTPUT_SENTINEL
        require_http_error(
            args.port,
            f"/tasks/{task['id']}/events/batch",
            TOKEN,
            422,
            {"events": [rejected_output]},
        )
        rejected_output["payload"].pop("stdout")
        rejected_output["payload"]["transcript"] = RAW_OUTPUT_SENTINEL
        require_http_error(
            args.port,
            f"/tasks/{task['id']}/events/batch",
            TOKEN,
            422,
            {"events": [rejected_output]},
        )
        print("TERMINAL_RAW_OUTPUT_REJECTED=PASS")
        print("TERMINAL_UNKNOWN_FIELDS_REJECTED=PASS")

        persisted = verify_sqlite(data_dir, event_ids)
        print("TERMINAL_SQLITE_REDACTION=PASS")
        print("TERMINAL_POST_REDACTION_REBOUND=PASS")
        verify_events_api(args.port, task["id"], event_ids, persisted)
        print("TERMINAL_API_REDACTION=PASS")

        request(args.port, f"/tasks/{task['id']}/end", TOKEN, "POST")
        package = request(
            args.port,
            f"/tasks/{task['id']}/ai/context-packages",
            TOKEN,
            "POST",
            {"config": {"estimated_input_token_budget": 32000}},
        )
        context = package["context"]
        verify_context(context, event_ids, persisted)
        print("TERMINAL_CONTEXT_ALLOWLIST=PASS")
        print("TERMINAL_CONTEXT_EVIDENCE=PASS")

        stop_owned_backend(first, port=args.port, token=TOKEN)
        assert_owned_backend_exited(first)
        first = None

        second = start_owned_backend(executable, environment=environment)
        owned_processes.append(second)
        wait_for_health(args.port, second, TOKEN)
        recovered = request(args.port, f"/ai/context-packages/{package['id']}", TOKEN)
        recovered_context = recovered.get("context", {})
        require(recovered_context == context, "restart did not recover the immutable persisted Context")
        verify_context(recovered_context, event_ids, persisted)
        print("RESTART_RECOVERY=PASS")
        print("STAGE12B_PACKAGED_TERMINAL_COMMAND=PASS")
    finally:
        cleanup_errors = []
        for process in owned_processes:
            try:
                if process.poll() is None:
                    stop_owned_backend(process, port=args.port, token=TOKEN)
                assert_owned_backend_exited(process)
            except Exception as error:
                cleanup_errors.append(f"PID {process.pid}: {error}")
        shutil.rmtree(str(data_dir), ignore_errors=True)
        if cleanup_errors:
            raise RuntimeError("owned backend cleanup failed: " + "; ".join(cleanup_errors))

    require(all(process.poll() is not None for process in owned_processes), "an owned backend is still running")
    print("OWNED_BACKEND_ZERO=PASS")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"STAGE12B_PACKAGED_TERMINAL_COMMAND=FAIL: {error}", file=sys.stderr)
        sys.exit(1)
