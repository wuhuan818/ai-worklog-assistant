"""Local, secret-safe OpenAI-compatible Fake Provider for Stage 09 verification.

It deliberately keeps only aggregate request assertions in memory.  In
particular, it never serializes headers, authorization values, prompts, or
request bodies to stdout or disk.  Select a response with
``FAKE_AI_SUMMARY_SCENARIO`` and bind with ``FAKE_AI_SUMMARY_PORT``.
"""
from __future__ import annotations

import json
import os
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = int(os.environ.get("FAKE_AI_SUMMARY_PORT", "8766"))
SCENARIO = os.environ.get("FAKE_AI_SUMMARY_SCENARIO", "valid_json_schema")
METRICS = {"request_count": 0, "authorization_present_count": 0, "ready_context_only": True,
           "api_key_in_body_count": 0, "raw_task_bypass_count": 0}


def draft(evidence_ref: str = "event:note-1") -> dict:
    return {"schema_version": "ai-summary-draft/v1", "sections": {
        "task_summary": {"summary": "Synthetic verified task", "outcomes": ["Ready context used"], "evidence_refs": [evidence_ref]},
        "code_changes": [], "commands_and_results": [], "bug_solutions": [],
        "unresolved_issues": [], "todos": [],
        "daily_report": {"title": "Synthetic daily report", "body": "Generated from Ready Context only.", "highlights": [], "blockers": [], "next_focus": [], "evidence_refs": [evidence_ref]},
        "knowledge_candidates": []}}


def scenario_content(evidence_ref: str = "event:note-1") -> str:
    value = json.dumps(draft(evidence_ref), ensure_ascii=False)
    if SCENARIO == "json_code_fence": return "```json\n" + value + "\n```"
    if SCENARIO == "valid_json_in_code_fence": return "```json\n" + value + "\n```"
    if SCENARIO == "extra_text": return "Result: " + value
    if SCENARIO == "valid_json_with_prefix": return "Here is the requested draft:\n" + value + "\nEnd of draft."
    if SCENARIO == "empty_content": return ""
    if SCENARIO == "invalid_json": return "{not json}"
    if SCENARIO == "missing_section":
        broken = draft(evidence_ref); del broken["sections"]["todos"]; return json.dumps(broken)
    if SCENARIO == "wrong_type":
        broken = draft(evidence_ref); broken["sections"]["code_changes"] = "not-an-array"; return json.dumps(broken)
    if SCENARIO == "daily_report_wrong_type":
        broken = draft(evidence_ref); broken["sections"]["daily_report"]["highlights"] = "not-an-array"; return json.dumps(broken)
    if SCENARIO == "invalid_evidence_ref":
        broken = draft(evidence_ref); broken["sections"]["task_summary"]["evidence_refs"] = ["invented:ref"]; return json.dumps(broken)
    if SCENARIO == "oversized_output": return json.dumps({"payload": "x" * 2_100_000})
    return value


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_args):
        # BaseHTTPRequestHandler otherwise logs paths and can accidentally add
        # future request data to test output.
        return

    def _json(self, status: int, data: dict) -> None:
        raw = json.dumps(data).encode("utf-8")
        self.send_response(status); self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw))); self.end_headers(); self.wfile.write(raw)

    def do_GET(self):
        if self.path == "/metrics": self._json(200, METRICS); return
        self._json(404, {"error": "not_found"})

    def do_POST(self):
        size = int(self.headers.get("Content-Length", "0"))
        try: body = json.loads(self.rfile.read(size).decode("utf-8"))
        except (ValueError, UnicodeDecodeError): body = {}
        METRICS["request_count"] += 1
        METRICS["authorization_present_count"] += int(bool(self.headers.get("Authorization")))
        encoded = json.dumps(body, ensure_ascii=False)
        METRICS["api_key_in_body_count"] += int("api_key" in encoded.lower() or "authorization" in encoded.lower())
        messages = body.get("messages", []) if isinstance(body, dict) else []
        joined = json.dumps(messages, ensure_ascii=False)
        METRICS["ready_context_only"] &= "<context-package>" in joined and "</context-package>" in joined
        METRICS["raw_task_bypass_count"] += int("raw-task-table" in joined)
        if SCENARIO == "timeout": time.sleep(10)
        if SCENARIO == "connection_reset": self.connection.close(); return
        status = {"401": 401, "403": 403, "404": 404, "429": 429, "500": 500, "json_schema_rejected": 400}.get(SCENARIO)
        if status: self._json(status, {"error": SCENARIO}); return
        evidence_ref = "event:note-1"
        start, end = joined.find("<context-package>"), joined.find("</context-package>")
        if start >= 0 and end > start:
            try:
                context = json.loads(joined[start + len("<context-package>"):end].replace('\\"', '"'))
                refs = context.get("provenance", {}).get("included_source_refs", [])
                if refs: evidence_ref = str(refs[0])
            except (TypeError, ValueError): pass
        content = scenario_content(evidence_ref)
        if SCENARIO == "openai_content_parts": content = [{"type": "text", "text": content}]
        if SCENARIO == "empty_content_with_reasoning": content = ""
        response = {"choices": [{"message": {"content": content, "reasoning_content": "never persist this"}}]}
        if SCENARIO != "usage_absent": response["usage"] = {"prompt_tokens": 10, "completion_tokens": 20, "total_tokens": 30}
        self._json(200, response)


if __name__ == "__main__":
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
