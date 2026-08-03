import os
import sys

import pytest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from app.ai.context.budgeting import BudgetError, apply_budget, estimate_tokens
from app.ai.context.normalization import normalize_path, sensitive_file_category, stable_json
from app.ai.context.redaction import redact_text


def test_redaction_is_idempotent_and_preserves_uuid_sha():
    source = "中文 Authorization: Bearer test-token-secret-123 password=hunter2 ghp_abcdefghijklmnopqrst"
    redacted, categories = redact_text(source)
    assert "hunter2" not in redacted and "test-token-secret-123" not in redacted
    assert categories["password"] == 1 and categories["bearer-token"] == 1
    assert redact_text(redacted)[0] == redacted
    safe = "123e4567-e89b-12d3-a456-426614174000 deadbeefdeadbeef"
    assert redact_text(safe) == (safe, {})


def test_normalization_hides_external_and_multi_root_paths():
    roots = {"one": r"C:\\Users\\Alice\\one", "two": r"D:\\work\\two"}
    assert normalize_path(r"C:\\Users\\Alice\\one\\src\\a.py", roots) == "one/src/a.py"
    assert normalize_path(r"E:\\private\\x.pem", roots) == "<external-path>/x.pem"
    assert sensitive_file_category(".env.production") == "credential-file"
    assert stable_json({"b": 1, "a": "中"}) == '{"a":"中","b":1}'


def test_cjk_estimate_and_budget_excludes_sensitive_diffs():
    assert estimate_tokens("abcd") == 1
    assert estimate_tokens("中文") == 2
    package = {
        "task": {"task_id": "t", "title": "title", "status": "completed"},
        "manual_notes": ["important note"],
        "debug_events": ["debug " * 300],
        "file_changes": [
            {"path": ".env", "diff": "token=not-retained"},
            {"path": "src/a.py", "diff": "line\n" * 1000},
        ],
    }
    result = apply_budget(package, 350)
    assert result["budget"]["estimated_tokens_after"] <= 350
    assert result["file_changes"][0]["sensitive_content_excluded"] is True
    assert "token=not-retained" not in str(result)
    assert result["budget"]["truncated"] is True


def test_minimum_context_failure_is_explicit():
    with pytest.raises(BudgetError, match="minimum_context_exceeds_budget"):
        apply_budget({"task": {"title": "x" * 1000}}, 1)
