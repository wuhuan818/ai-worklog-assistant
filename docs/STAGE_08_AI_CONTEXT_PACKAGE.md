# Stage 08: AI Context Package

Stage 08 builds a local, privacy-safe `task-context-package/v1` for a completed task. It is a reviewable input snapshot, not an AI request: this stage does not contact a provider, read `SecretStorage`, scan a workspace, reopen source files, read shell history, or generate a model summary.

## Boundary and sources

The builder consumes only persisted project/task metadata and recorded notes, Bugs and resolution history, file events and captured diff summaries, diagnostics, command/task summaries, debug events, and statistics. A file event without a persisted diff is represented as a change with no available text diff; it is never filled in from the filesystem.

The stored package contains only its sanitized JSON snapshot. It never stores a raw input copy, API key, Authorization value, provider response, prompt, or model reasoning.

## Contract

Packages have `schema_version: task-context-package/v1`, a UUID context ID, `preview`, `ready`, `superseded`, or `invalid` status, UTC timestamps, stable ordering, and a SHA-256 content hash. Volatile IDs and lifecycle timestamps are excluded from the business-content hash. With identical recorded data and build configuration, business JSON, source/privacy/budget reports, and hash are deterministic.

Build configuration is `context-build-config/v1`; the default estimated input budget is 32,000 tokens and the accepted range is 4,000–128,000. The estimate is local and deterministic, not a billing-token count: ASCII-like runs use about four characters per token, while CJK and other Unicode text use a deliberately more conservative documented rule.

## Privacy pipeline

Before any budgeting, paths become slash-separated relative paths, multi-root paths are root-name-prefixed, and outside paths become `<external-path>/filename`. User-home, temporary, test-user-data and database absolute paths are not retained. The redactor replaces credentials with stable placeholders such as `<redacted:api-key>`, `<redacted:bearer-token>`, `<redacted:password>`, `<redacted:private-key>`, `<redacted:credential>`, and `<redacted:cookie>`; applying it again is idempotent.

Credential-like files (`.env`, private keys, credential/secret names, keystores, `.npmrc`, `.pypirc`, `.netrc`, and Docker config) retain only classified metadata, never body or diff. Binary changes retain only path/change/size metadata. Privacy reports count redactions, exclusions and removed paths and always state `raw_secret_retained: false` for a valid package.

## Budgeting and review lifecycle

The builder first preserves task identity/status/times, Bug and file/diagnostic summaries, and the provenance/privacy/budget reports. It then deterministically prioritizes notes, Bug resolutions, unresolved Bugs and errors ahead of lower-value diagnostics, files, diffs, command summaries and debug events. Diff limits are 8,000 characters/200 lines per file, 30 files, and 35% of final budget. Every omission or truncation is reported. If the minimum core cannot fit, the operation returns `minimum_context_exceeds_budget` and cannot become Ready.

Packages are immutable versions in SQLite. Rebuilding creates another preview; the same idempotency key is replay-safe. Marking a valid completed-task preview Ready is idempotent and transactionally supersedes the task's previous Ready version. Stage 9 may consume only Ready packages.

## UI and validation

The extension offers Preview, Rebuild, and Mark Ready commands plus a compact sidebar summary. The preview webview shows only sanitized data and reports, initializes HTML once with strict CSP/nonce, accepts message updates afterwards, and has no external resources or timer. `scripts/verify-ai-context-package.ps1` creates isolated data, checks deterministic build, privacy, paths, budget, provenance and Ready persistence, then writes the secret-free machine report. The short Extension Host smoke follows the same boundary.

## Inherited verification gaps

Stage 08 does not claim to resolve two Stage 7.1 evidence gaps: direct Reload Window automation and an independent startup orphan-cleanup integration test. They remain inherited, non-blocking verification gaps and are not Stage 08 scope.
