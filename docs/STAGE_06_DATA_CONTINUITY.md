# Stage 06: data continuity

The local server receives an explicit absolute `AI_WORKLOG_DATA_DIR` for every
launch.  Production and development default to the extension's stable global
storage `data` directory; tests must supply an isolated directory.  Neither
the workspace nor `process.cwd()` is a data-directory fallback.

Workspace identity version 1 hashes canonical file URIs.  Windows drive case,
separators and trailing separators normalize to the same identity.  Multi-root
workspaces hash sorted roots (or their `.code-workspace` URI).  The server uses
an identity-first, transactional project resolution endpoint and retains
legacy path rows by attaching their identity instead of creating a duplicate.

On activation, the extension waits for a healthy backend, resolves identity,
resolves the project, and only restores an active task when it belongs to that
project.  An active task for another workspace is a conflict: event capture
is disabled, no Bug is associated, and no replacement task is created.

## Input wizard stability supplement

Multi-step Task, Bug and resolution prompts use `ignoreFocusOut: true`.
`undefined` means cancellation and ends the entire wizard; an explicit empty
string is an accepted optional value. No write is sent until every required
step has been accepted.
