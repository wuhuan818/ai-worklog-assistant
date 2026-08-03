# Stage 7.1 — Backend Shutdown Stability

Stage 7.1 gives each extension activation a UUID instance identity and each
backend launch a monotonically increasing generation. The extension records a
non-secret ownership record in its global-storage runtime directory using an
atomic temporary-file rename. Records contain only PID, extension-host PID,
executable path, data directory, generation and timestamps; session tokens and
provider credentials are never written there.

`deactivate()` now has a bounded shutdown path: event delivery is allowed up to
two seconds, then the extension authenticates `POST /runtime/shutdown`, waits
for normal exit, and only then terminates the current owned child PID tree as a
bounded fallback. Shutdown is idempotent and prevents later starts/restarts.

The local server exposes the loopback, session-token-authenticated runtime
endpoint. Its Uvicorn server receives the exit request and Windows builds also
wait on the Extension Host process handle (`OpenProcess(SYNCHRONIZE)` and
`WaitForSingleObject`). If the parent dies unexpectedly, the watchdog asks
Uvicorn to exit; handles and watchdog threads are released on normal shutdown.

The build script uses an atomically acquired, process-start-time-validated lock
and a unique PyInstaller work/dist/spec directory for every run. A stale lock
is safely removed, while a verified live builder is left alone. This project
never performs name-wide backend kills: any fallback targets only the tracked
child PID.
