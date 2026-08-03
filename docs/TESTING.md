# Testing

## Stage 4 Extension Host E2E

The event-capture E2E uses a real VS Code Extension Host, a temporary fixture workspace, the packaged backend executable, and a temporary data directory.

From `apps/vscode-extension`:

```powershell
npm.cmd run compile
npm.cmd run test:e2e:event-capture
```

The test exercises activation, task/project creation, file change/save, diagnostics, a real VS Code task, a real debug session, manual notes, backend restart persistence, continued capture, end-task flushing, SQLite validity, log redaction, and process cleanup. The machine-readable result is written to `artifacts/test-results/stage04-extension-host-e2e.json`.

On the managed Windows desktop, run the verifier from an elevated test shell only when the Extension Host reports an `EPERM lstat C:\Users\...` module-resolution error:

```powershell
.\scripts\verify-extension-host-event-e2e.ps1
```

The verifier builds the backend/extension and checks the report status. The E2E runner uses `VSCODE_EXECUTABLE` when supplied and otherwise downloads the pinned VS Code test runtime.

The report also includes `viewReopenStateConsistency`, `backendPidUnchangedAfterViewReopen`, `activeTaskPreservedAfterViewReopen`, and `eventSummaryPreservedAfterViewReopen`.

## Stage 5 Bug lifecycle verifier

From the repository root, build the packaged backend and run:

```powershell
.\scripts\build-backend.ps1
.\scripts\verify-bug-lifecycle.ps1
```

The verifier uses a random port, token and temporary data directory. It creates two Bugs, validates atomic switching and event `bug_id` association, writes a Bug note, resolves/reopens a Bug, restarts against the same SQLite database, ends the task, and checks that completed-task modifications return 409. It always cleans its bounded server process tree and temporary directory. Run it three times for the stage gate.

The Extension Host E2E additionally verifies the UI state, collectors and pending-buffer association; a GUI pass remains required for final interaction acceptance.
# Bug button stability

`node test/runBugLifecycleE2E.js` verifies a stable active Bug snapshot over five seconds, including a stable backend PID.  Unit tests cover snapshot fingerprint de-duplication and the single button-state matrix.
# Stage 06 data continuity

Run `scripts\verify-data-continuity.ps1` for the isolated multi-process
Extension Host verification.  It produces the ignored machine-readable report
`artifacts/test-results/stage06-data-continuity.json`.

Wizard-input unit tests verify cancellation is distinct from accepted empty
input. The Stage 06 report also contains the independent cross-workspace
re-verification result.
# Stage 7 Extension Host diagnostics

Run the isolated canary before a Provider E2E run:

```powershell
cd apps/vscode-extension
npm.cmd run test:e2e:canary
```

The downloaded VS Code test process must be launched outside the restrictive filesystem sandbox. Do not use the user's installed VS Code or `--disable-extensions`; the latter prevents the VS Code extension-test runner from loading. Failed diagnostics are retained under `artifacts/e2e-diagnostics` and contain no API keys.

## Stage 07 final Provider evidence

Run `scripts\verify-ai-provider-foundation.ps1` for the backend contract and `scripts\verify-extension-host-ai-provider-e2e.ps1` for the real Extension Host. The latter uses an in-memory fake provider and a unique synthetic key; the key and Authorization header must not appear in artifacts or logs. It covers provider switching, SecretStorage, profile persistence, reconnect behavior, view reopening, and redacted HTTP/transport/invalid-response failures. The normalized result is `artifacts/test-results/stage07-ai-provider-foundation.json`; it is UTF-8 JSON without a BOM and derives Extension Host booleans from that run rather than hand-editing them.

The Stage 06 data-continuity verifier intentionally does not retry a failed Extension Host run. `runDataContinuityDiagnostic.js` is a diagnostic-only entry point: it preserves a failed bounded diagnostic directory and cleans a successful one; it is not an alternate passing test path.

## Stage 07.1 shutdown stability

Run `scripts\verify-backend-parent-watchdog.ps1` three times, `scripts\verify-extension-host-backend-shutdown-e2e.ps1` three times, and `scripts\verify-backend-multi-instance-isolation.ps1` once. The Extension Host scripts use isolated profiles and must run outside the restrictive GUI/filesystem sandbox. Data Continuity has a 240-second total deadline, a 60-second per-host no-progress deadline, and `host1` through `host4` markers. No verifier retries failure into success or kills backends by image name.
## Stage 7 snapshot verification boundary

The Stage 7 snapshot includes three Provider-contract rounds, two short Provider smoke rounds, Python and TypeScript verification, and backend lifecycle stages 2–5. The Stage 6 final run exceeded its execution window, while final Event and Bug Extension Host regressions were not rerun; none of these are claimed as passing in the Stage 7 snapshot report. Manual acceptance separately verified real DeepSeek connection, restart persistence, connection reset to `not-tested`, reconnection, view reopen, and API-key redaction.
