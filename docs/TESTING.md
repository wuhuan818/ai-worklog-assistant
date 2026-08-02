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
