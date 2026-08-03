# Stage 07 Completion Evidence

## Provider behavior

DeepSeek, Qwen and custom OpenAI-compatible connection contracts are verified. DeepSeek sends an explicit thinking toggle, Qwen uses `enable_thinking`, and custom profiles use only standard completion fields. Connection checks send a fixed synthetic prompt only; task, Bug, note, event, source and diff data are excluded. Automatic cross-provider fallback is disabled.

Qwen workspace-specific domains are supported for Beijing, Singapore, Tokyo and Frankfurt; Virginia uses the public US endpoint. Workspace IDs are configuration metadata and endpoint summaries redact them.

## Extension state and security

Profiles live in VS Code global state while API keys live only in SecretStorage. Sidebar state is versioned, scoped to the current profile, and transitions through `not-configured`, `not-tested`, `testing`, `connected` and `failed`. It resets after extension restart so a historical success is never presented as a live connection.

The Provider Host test covers 401, 403, 404, 429, 500, timeout, TCP connection reset, invalid JSON, missing fields and oversized responses. Each run uses a random in-memory key; artifact scans found zero occurrences of that key, zero SQLite secrets, and no remaining test processes.

## Final verification record

### Accepted snapshot with known blocker

Stage 7 is accepted as an implementation snapshot after manual product acceptance. Automatic verification passed for Python, TypeScript, three Provider contract rounds, two short Provider smoke rounds, and backend lifecycle stages 2–5. The final Stage 6 run exceeded its execution window; final Event and Bug Extension Host regressions were not rerun and are explicitly not represented as passing.

An observed product lifecycle defect remains: in some VS Code shutdown paths, an extension-owned `ai-worklog-server.exe` can outlive the Extension Host. Six repository backend instances were observed and safely cleaned. This can interfere with later hosts and builds. The next corrective scope is `stage/07.1-backend-shutdown-stability`; Stage 8 must wait for that work and a formal Stage 7 release decision.

Automatic evidence consists of three backend contract rounds and two short,
single-host connection-smoke rounds. The smoke test uses VS Code 1.85.2 with
`shell: false`, creates its random synthetic key in the Extension Host using
explicit `node:crypto`, and confirms the key is absent from public state and
the ViewModel. It does not send work data.

The isolated dual-host VS Code test environment did not create an extension
global-state database readable by the second host; this is a test-environment
limitation, not product-failure evidence. The corresponding product behaviour
was manually accepted: a real DeepSeek profile and SecretStorage key survived
a complete Extension Development Host restart, began as `not-tested`, and
reconnected successfully. View reopen and key redaction were also manually
accepted. The machine report explicitly distinguishes these manual results
from automatic evidence.

Data continuity verification has no blind retry. Its diagnostic wrapper keeps
only failing temporary directories for investigation and cleans successful
runs.
