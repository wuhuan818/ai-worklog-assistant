# Stage 09: AI Summary Generation

Stage 09 creates a read-only, locally validated AI summary draft from one persisted Ready Context Package.  It does not approve, edit, compare, export, or publish a draft.

## Boundary

Generation accepts only a `task-context-package/v1` whose status is `ready`.  The backend retrieves it by `context_id`; it does not reconstruct context from task, event, Bug, workspace, terminal, Git, or filesystem data. Invalid, missing, non-ready, unsupported-schema, hashless, or privacy-invalid contexts are rejected.

The prompt version is `ai-summary-prompt/v1`; the output schema version is `ai-summary-draft/v1`. Context JSON is fenced as untrusted data, never as instructions. The system contract requires the model to ignore commands, role changes, or secret requests within the context and to return empty lists when evidence is absent.

## Draft contract

Every valid draft has exactly these eight sections: `task_summary`, `code_changes`, `commands_and_results`, `bug_solutions`, `unresolved_issues`, `todos`, `daily_report`, and `knowledge_candidates`. Evidence references are deduplicated and must be a subset of the Ready Context Package provenance references. Text, collection sizes, paths, and sensitive values receive local validation and redaction before persistence. The final stored JSON has a stable content hash.

The server stores only the validated, redacted draft and safe job metadata. It never stores API keys, Authorization headers, full prompts, raw provider responses, or provider reasoning. A draft is immutable and has only the user-visible `draft` state in this stage.

## Provider and retries

DeepSeek, Qwen, and a Custom OpenAI-compatible profile share the structured-summary interface. Providers can use JSON Schema, JSON Object, or a Custom-provider prompt-only compatibility mode; local schema validation remains authoritative. Generation is non-streaming, uses the selected profile only, and never fetches models or falls back to another provider.

At most three provider requests are permitted per job. One repair request may correct malformed structured content; limited transport retry is restricted to transient timeout/429/5xx failures. Authentication failures, missing keys, missing models, cancellation, and invalid context never retry. A cancellation prevents late responses from creating drafts.

## Jobs and preview

Jobs transition through `queued`, `running`, `validating`, then `succeeded`, `failed`, `cancelled`, or `interrupted`. Reusing an idempotency key returns the existing job. A backend restart marks in-flight jobs interrupted and never resumes a paid request.

The extension shows a send confirmation before reading the SecretStorage key or creating a job. It displays the task, context/hash summary, schema, estimated input tokens, redaction/truncation counts, provider, profile, model, thinking setting, and output-token limit. The Summary Draft panel is read-only and renders all eight sections, evidence, usage, and latency without showing keys, reasoning, or raw provider content. Closing and reopening the panel reads the persisted draft.

## Verification

`scripts/verify-ai-summary-generation.ps1` runs isolated Fake Provider and backend contracts and emits `artifacts/test-results/stage09-ai-summary-generation.json`. `scripts/verify-extension-host-ai-summary-smoke-e2e.ps1` runs the bounded Extension Host smoke with a synthetic secret and Fake Provider only. Neither verifier contacts a real provider or kills processes by image name.

Stage 10 is responsible for editing, regenerating, approving, rejecting, Markdown export, and knowledge-base writes.
