# Stage 10A — Summary Review Workflow

`ai_summary_drafts` is the immutable, validated AI-origin source of truth. User edits never update it: each explicit save creates a separately validated `ai_summary_revisions` row. Revision content remains `ai-summary-draft/v1`, is checked against source Evidence Refs, and is redacted before storage.

`ai_summary_reviews` records independent `approved` and `rejected` audit events. A partial unique index guarantees one unsuperseded approved revision per task; approving a newer revision supersedes the previous approval in the same transaction. Rejecting requires a reason and never deletes a draft or revision. Task lifecycle remains `active`, `completed`, or `cancelled`; approval never changes a completed task.

The legacy `summary_drafts` mock endpoints remain only for compatibility and are not used by this workflow. Markdown export and knowledge publication remain Stage 10B work.
