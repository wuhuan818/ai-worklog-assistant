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
