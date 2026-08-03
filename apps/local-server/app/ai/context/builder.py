from __future__ import annotations

import json
import uuid
from collections import Counter
from typing import Any
from .models import ContextBuildConfig, SCHEMA_VERSION
from .provenance import content_hash

def _redact(value: Any) -> Any:
    try:
        from app.ai.context.redaction import redact_text
        if isinstance(value, str): return redact_text(value)[0]
        if isinstance(value, list): return [_redact(item) for item in value]
        if isinstance(value, dict): return {key: _redact(item) for key, item in value.items()}
        return value
    except ImportError:
        return value

def _redact_with_counts(value: Any, counts: Counter) -> Any:
    try:
        from app.ai.context.redaction import redact_text
        if isinstance(value, str):
            redacted, found = redact_text(value); counts.update(found); return redacted
        if isinstance(value, list): return [_redact_with_counts(item, counts) for item in value]
        if isinstance(value, dict): return {key: _redact_with_counts(item, counts) for key, item in value.items()}
    except ImportError:
        pass
    return value

def _estimate(value: Any) -> int:
    try:
        from app.ai.context.budgeting import estimate_tokens
        return int(estimate_tokens(value if isinstance(value, str) else json.dumps(value, ensure_ascii=False)))
    except ImportError:
        return max(1, (len(json.dumps(value, ensure_ascii=False)) + 3) // 4)

def _payload(row) -> dict:
    try: return json.loads(row["payload_json"])
    except (ValueError, TypeError): return {}

def build(c, task_id: str, config: ContextBuildConfig) -> dict:
    task = c.execute("SELECT * FROM tasks WHERE id=? AND user_id=?", (task_id, "local-user")).fetchone()
    if not task: raise KeyError("task_not_found")
    project = c.execute("SELECT * FROM projects WHERE id=?", (task["project_id"],)).fetchone()
    events = c.execute("SELECT * FROM worklog_events WHERE task_id=? ORDER BY sequence,occurred_at,id", (task_id,)).fetchall()
    legacy = c.execute("SELECT * FROM events WHERE task_id=? ORDER BY timestamp,id", (task_id,)).fetchall()
    bugs = c.execute("SELECT * FROM bugs WHERE task_id=? ORDER BY created_at,id", (task_id,)).fetchall()
    source_counts = Counter()
    refs = []
    notes=[]; file_changes=[]; diagnostics=[]; commands=[]; debug=[]
    for event in events:
        payload = _payload(event); et = event["event_type"]
        source_counts["events"] += 1; refs.append({"type": et, "id": event["id"]})
        if et == "manual_note" and config.include_manual_notes:
            text = payload.get("text") or payload.get("note") or payload.get("message")
            if text: notes.append({"id": event["id"], "text": text, "created_at": event["occurred_at"]}); source_counts["manual_notes"] += 1
        elif et in {"file_changed", "file_saved"} and config.include_file_changes:
            from app.ai.context.normalization import normalize_path, sensitive_file_category
            normalized_path = normalize_path(event["file_path"] or payload.get("path") or "<unknown>", [event["workspace_path"]] if event["workspace_path"] else None)
            item = {"id": event["id"], "path": normalized_path, "occurred_at": event["occurred_at"], "change_type": payload.get("change_type", "modified")}
            if sensitive_file_category(normalized_path):
                item.update({"sensitive_content_excluded": True, "sensitive_category": "credential-file"})
            file_changes.append(item); source_counts["file_events"] += 1
        elif et == "diagnostics_changed" and config.include_diagnostics:
            diagnostics.append(dict(payload, id=event["id"], occurred_at=event["occurred_at"])); source_counts["diagnostics"] += 1
        elif et.startswith("vscode_task_") and config.include_commands_and_tasks:
            commands.append(dict(payload, id=event["id"], event_type=et, occurred_at=event["occurred_at"])); source_counts["commands"] += 1
        elif et.startswith("debug_") and config.include_debug_events:
            debug.append(dict(payload, id=event["id"], event_type=et, occurred_at=event["occurred_at"])); source_counts["debug_events"] += 1
    bug_items=[]
    if config.include_bug_details:
        for bug in bugs:
            item={k: bug[k] for k in ("id","title","status","severity","created_at","resolved_at","description") if k in bug.keys()}
            item["notes"]=[dict(row) for row in c.execute("SELECT id,text,created_at FROM bug_notes WHERE bug_id=? ORDER BY created_at,id", (bug["id"],))]
            item["resolutions"]=[dict(row) for row in c.execute("SELECT id,resolution_summary,root_cause,verification,created_at FROM bug_resolutions WHERE bug_id=? ORDER BY created_at,id", (bug["id"],))]
            bug_items.append(item); source_counts["bugs"] += 1; source_counts["bug_notes"] += len(item["notes"]); source_counts["bug_resolutions"] += len(item["resolutions"])
    package={"schema_version": SCHEMA_VERSION, "context_id": str(uuid.uuid4()), "status":"preview",
      "project":{"project_id": task["project_id"], "display_name": project["name"] if project else "", "workspace_identity_summary": (project["workspace_identity_key"] or "") if project and "workspace_identity_key" in project.keys() else ""},
      "task":{"task_id":task["id"],"title":task["name"],"status":task["status"],"started_at":task["started_at"],"ended_at":task["ended_at"],"active_duration_seconds":int(task["duration_seconds"] or 0),"manual_notes":notes},
      "bugs":bug_items,"file_changes":file_changes,"diagnostics":diagnostics,"commands_and_tasks":commands,"debug_events":debug,
      "event_summary":{"total":len(events)+len(legacy),"by_type":dict(sorted(Counter(e["event_type"] for e in events).items()))} if config.include_event_summary else {},
      "statistics":{"bugs":len(bug_items),"file_changes":len(file_changes),"diagnostics":len(diagnostics)},
      "provenance":{"source_counts":dict(sorted(source_counts.items())),"included_source_refs":refs,"excluded_source_counts":{}},
      "privacy":{"redaction_count":0,"redaction_categories":{},"sensitive_files_excluded":0,"absolute_paths_removed":0,"binary_contents_excluded":0,"raw_secret_retained":False},
      "budget":{"estimated_token_budget":config.estimated_input_token_budget,"estimated_tokens_before":0,"estimated_tokens_after":0,"characters_before":0,"characters_after":0,"truncated":False,"truncation_categories":{},"omitted_item_counts":{}}}
    redactions = Counter()
    package = _redact_with_counts(package, redactions)
    package["privacy"]["redaction_count"] = sum(redactions.values())
    package["privacy"]["redaction_categories"] = dict(sorted(redactions.items()))
    package["privacy"]["sensitive_files_excluded"] = sum(1 for item in file_changes if item.get("sensitive_content_excluded"))
    try:
        from app.ai.context.budgeting import apply_budget
        package = apply_budget(package, config.estimated_input_token_budget)
    except ImportError:
        chars=len(json.dumps(package, ensure_ascii=False)); tokens=_estimate(package)
        package["budget"].update({"characters_before":chars,"characters_after":chars,"estimated_tokens_before":tokens,"estimated_tokens_after":tokens})
    package["content_hash"] = content_hash(package)
    package["provenance"]["content_hash"] = package["content_hash"]
    return package
