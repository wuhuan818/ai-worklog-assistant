import os
import sys
import time

import pytest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from app.ai.context.budgeting import BudgetError, apply_budget, estimate_tokens
from app.ai.context.normalization import normalize_path, sensitive_file_category, stable_json
from app.ai.context.redaction import redact_terminal_command, redact_text


def test_redaction_is_idempotent_and_preserves_uuid_sha():
    source = "中文 Authorization: Bearer test-token-secret-123 password=hunter2 ghp_abcdefghijklmnopqrst"
    redacted, categories = redact_text(source)
    assert "hunter2" not in redacted and "test-token-secret-123" not in redacted
    assert categories["password"] == 1 and categories["bearer-token"] == 1
    assert redact_text(redacted) == (redacted, {})
    safe = "123e4567-e89b-12d3-a456-426614174000 deadbeefdeadbeef"
    assert redact_text(safe) == (safe, {})
    bounded = "A_TOKEN= <command-truncated>\n<diff-truncated>"
    assert redact_text(bounded) == (bounded, {})


@pytest.mark.parametrize("source,category", [
    ("OPENAI_API_KEY=plain-secret-value", "api-key"),
    ("GITHUB_TOKEN=plain-secret-value", "bearer-token"),
    ("PGPASSWORD=hunter2", "password"),
    ("curl -u alice:supersecret https://example.test", "credential"),
    ("curl -ualice:supersecret https://example.test", "credential"),
    ("curl -Uproxy:supersecret https://example.test", "credential"),
    ("curl --proxy-user=proxy:supersecret https://example.test", "credential"),
    ("curl --user alice:supersecret https://example.test", "credential"),
    ("sshpass -p supersecret ssh host", "password"),
    ("SSHPASS=supersecret sshpass -e ssh host", "password"),
    ("docker login -u alice -p supersecret registry.test", "password"),
])
def test_terminal_style_credentials_are_redacted(source, category):
    redacted, categories = redact_terminal_command(source)
    assert "plain-secret-value" not in redacted
    assert "hunter2" not in redacted
    assert "supersecret" not in redacted
    assert categories[category] == 1
    assert redact_terminal_command(redacted) == (redacted, {})


def test_quoted_header_redaction_preserves_command_structure():
    redacted, categories = redact_text('curl -H "X-API-Key: plain-secret-value" https://example.test')
    assert 'plain-secret-value' not in redacted
    assert '"X-API-Key: <redacted:api-key>"' in redacted
    assert categories == {"api-key": 1}

    bearer, bearer_categories = redact_terminal_command('curl -H "Authorization: Bearer ordinary-secret-value" https://example.test')
    assert bearer == 'curl -H "Authorization: Bearer <redacted:bearer-token>" https://example.test'
    assert bearer_categories == {"bearer-token": 1}

    basic, basic_categories = redact_terminal_command('curl -H "Authorization: Basic dXNlcjpwYXNz" https://example.test')
    assert basic == 'curl -H "Authorization: Basic <redacted:credential>" https://example.test'
    assert basic_categories == {"credential": 1}


@pytest.mark.parametrize("source,category", [
    ("npm.cmd config set //registry.npmjs.org/:_authToken ordinary-secret-value-123456", "bearer-token"),
    ("sshpass -psecret ssh host", "password"),
    ("mysql -psecret database", "password"),
])
def test_attached_and_registry_terminal_credentials_are_redacted(source, category):
    redacted, categories = redact_terminal_command(source)
    assert "secret" not in redacted.replace("<redacted", "")
    assert categories[category] == 1
    assert redact_terminal_command(redacted) == (redacted, {})


@pytest.mark.parametrize("source", [
    "python -u script.py",
    "sort -u names.txt",
    "ps --user alice",
    "mysql -P 3306 database",
    "mysql -p database",
    'sshpass -P "Password:" ssh host',
    "python -u script.py # curl mentioned in comment",
    "echo mysql -pnot-a-secret",
])
def test_non_curl_user_flags_are_not_redacted(source):
    assert redact_terminal_command(source) == (source, {})


def test_multiple_and_late_curl_credentials_are_all_redacted():
    padding = "x" * 700
    source = f"curl --data {padding} -u alice:firstsecret -U proxy:secondsecret https://example.test"
    redacted, categories = redact_terminal_command(source)
    assert "firstsecret" not in redacted and "secondsecret" not in redacted
    assert redacted.count("<redacted:credential>") == 2
    assert categories == {"credential": 2}


@pytest.mark.parametrize("source", [
    "cmd /c curl -u alice:wrappersecret https://example.test",
    "cmd.exe /d /c curl.exe -u alice:wrappersecret https://example.test",
    "powershell -Command curl.exe -u alice:wrappersecret https://example.test",
    'pwsh -c "curl -u alice:wrappersecret https://example.test"',
    "wsl curl -u alice:wrappersecret https://example.test",
    '& "curl.exe" -u alice:wrappersecret https://example.test',
    "env curl -u alice:wrappersecret https://example.test",
    "env FOO=x curl -u alice:wrappersecret https://example.test",
    "sudo -u root curl -u alice:wrappersecret https://example.test",
    "time -p curl -u alice:wrappersecret https://example.test",
    "nice curl -u alice:wrappersecret https://example.test",
    "nice -n 5 curl -u alice:wrappersecret https://example.test",
    "command -- curl -u alice:wrappersecret https://example.test",
    "env FOO=x sudo -u root time -p nice command -- curl -u alice:wrappersecret https://example.test",
])
def test_common_shell_wrappers_redact_curl_credentials(source):
    redacted, categories = redact_terminal_command(source)
    assert "wrappersecret" not in redacted
    assert categories == {"credential": 1}


@pytest.mark.parametrize("source", [
    "env echo curl -u alice:not-a-secret",
    "env FOO=x echo curl -u alice:not-a-secret",
    "sudo -u root echo curl -u alice:not-a-secret",
    "time -p echo curl -u alice:not-a-secret",
    "nice echo curl -u alice:not-a-secret",
    "command -- echo curl -u alice:not-a-secret",
])
def test_execution_wrappers_do_not_turn_echo_arguments_into_commands(source):
    assert redact_terminal_command(source) == (source, {})


def test_terminal_wrapper_detection_is_bounded_for_long_prefixes():
    assignments = " ".join(f"F{index}=x" for index in range(800))
    source = f"env {assignments} curl -u alice:wrappersecret https://example.test"
    started = time.perf_counter()
    redacted, categories = redact_terminal_command(source)
    assert time.perf_counter() - started < 2.0
    assert "wrappersecret" not in redacted
    assert categories == {"credential": 1}

    negative = f"env {assignments} echo curl -u alice:not-a-secret"
    started = time.perf_counter()
    assert redact_terminal_command(negative) == (negative, {})
    assert time.perf_counter() - started < 2.0


def test_generic_redaction_remains_bounded_for_large_code_diff_text():
    source = ("curl x " * 35000)[:245000]
    started = time.perf_counter()
    assert redact_text(source) == (source, {})
    assert time.perf_counter() - started < 3.0


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


def test_budget_prunes_evidence_for_removed_command_items():
    commands = [
        {"id": f"command-{index}", "event_type": "terminal_command", "command": "x" * 1200}
        for index in range(4)
    ]
    package = {
        "task": {"task_id": "task", "title": "budget", "status": "completed", "manual_notes": []},
        "commands_and_tasks": commands,
        "provenance": {"included_source_refs": [{"type": "terminal_command", "id": item["id"]} for item in commands]},
    }
    result = apply_budget(package, 350)
    visible_ids = {item["id"] for item in result["commands_and_tasks"]}
    retained_ref_ids = {item["id"] for item in result["provenance"]["included_source_refs"]}
    assert len(visible_ids) < len(commands)
    assert retained_ref_ids == visible_ids
    assert result["budget"]["omitted_item_counts"]["provenance.included_source_refs"] == len(commands) - len(visible_ids)
