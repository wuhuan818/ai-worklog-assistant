# Stage 12A Final Report — Code Change Capture v2

Date: 2026-08-09

## 1. Executive Result

**Stage 12A status: PASS**

AI Worklog Assistant can now capture a real, bounded save-time code diff while a user-controlled Task is active; persist it safely; and supply it to the Context Package as resolvable `code_diff` Evidence.

## 2. Branch / Git

| Item | Value |
|---|---|
| Branch | `stage/12-code-change-capture` |
| Base | `77cde41` (`submission/phase1-materials`) |
| Stage 12A commit | `5a74646 feat: capture save-time code diffs` |
| Remote branch | `origin/stage/12-code-change-capture` |
| Remote push | Passed |
| Working tree at delivery | Clean |

Pull-request URL: <https://github.com/wuhuan818/ai-worklog-assistant/pull/new/stage/12-code-change-capture>

## 3. Audit Findings

| Severity | Finding | Evidence | Action |
|---|---|---|---|
| High | Saved-file events recorded only aggregate line counts; no actual before/after source evidence survived. | Extension save handler emitted `diff_summary` only; Context discarded event payloads. | Added save-time `code_diff` events, persistence, Context projection, and Evidence refs. |
| High | A first save without a valid baseline could be interpreted as a change from an empty document. | Existing save baseline defaulted to an empty string. | Added active-Task in-memory priming and an explicit `baseline` result that never captures a whole file as a diff. |
| Medium | Configured file and diff limits were declared but not applied to capture. | `maxFileSizeBytes`, `maxDiffBytes`, and `exclude` were not consumed by the capture controller. | Applied limits, glob exclusions, binary/generated/lock-file filters, and UTF-8 byte truncation. |
| High | Existing event persistence did not provide sufficient redaction coverage for real code diffs. | Prior persistence redaction mainly matched a narrow token pattern. | Reused the established local redactor before persistence, retained redaction metadata, and preserved the legacy endpoint's `[REDACTED]` contract. |
| Medium | Context top-level truncation metadata did not reflect capture-time diff truncation. | `truncation_count` was persisted as zero. | Aggregate capture-time and Context-budget truncations. |
| Medium | A disabled diff-snippet Context could still permit a `code_diff` Evidence ref. | Provenance refs were initially populated before the feature-toggle branch. | Remove disabled/excluded diff refs from the Context evidence allow-list. |

## 4. Architecture Decision

### Selected approach

**Option B: active-edit lightweight in-memory tracking plus save-time snapshot diff.**

The extension snapshots eligible open documents only while recording is enabled for an active Task. On save, it compares the prior saved baseline with the current document, emits a bounded line-oriented unified patch, then updates the in-memory baseline.

### Why this approach

- Works in non-Git workspaces; Git is not a prerequisite.
- Captures the saved document state, rather than an arbitrary working-tree state.
- Keeps full document snapshots in memory only for the active Task.
- Emits one durable `code_diff` event only when content actually changed.
- Is deterministic and unit-testable without an external provider.

### Why other approaches were not selected

- **Per-change incremental persistence:** increases event volume and complexity, and creates more partial/intermediate source persistence.
- **Git diff:** cannot support non-Git workspaces or unsaved editor state as the primary path.
- **Hybrid Git-first design:** adds complexity without improving the required save-time, non-Git baseline.

## 5. Implementation

```text
VS Code document save
  -> SaveDiffTracker baseline
  -> code_diff buffered event
  -> POST /tasks/{task_id}/events/batch
  -> worklog_events SQLite payload_json
  -> Context Package code_diffs
  -> provenance code_diff:<event-id>
  -> AI Summary code_changes evidence allow-list
```

Key implementation files:

- Extension capture policy and textual diff: `apps/vscode-extension/src/eventCapture/codeDiff.ts`
- Active-Task baseline tracker: `apps/vscode-extension/src/eventCapture/saveDiffTracker.ts`
- VS Code lifecycle hooks and event emission: `apps/vscode-extension/src/eventCapture/eventCaptureController.ts`
- API event union and UI Evidence label: `apps/vscode-extension/src/apiClient.ts`, `apps/vscode-extension/src/ai/generation/formModel.ts`
- Backend validation, redaction, and persistence: `apps/local-server/app/main.py`
- Context selection, Evidence provenance, and budgeting: `apps/local-server/app/ai/context/builder.py`, `budgeting.py`, `service.py`

## 6. Privacy / Bounds

- Capture is limited to active user-controlled Tasks.
- Ineligible paths include credential files (`.env`, key files, credential/secret names), binaries, dependency/vendor directories, build outputs, generated files, lock files, large files, likely minified files, and user-configured exclusion globs.
- File-size default: 1 MiB; configurable up to 10 MiB.
- Diff-size default: 200 KiB; hard-capped at 245 KiB before the 256 KiB event payload boundary.
- Truncated patches contain explicit metadata and a `<diff-truncated>` marker.
- Secrets are redacted locally before `worklog_events` persistence and again when Context is built.
- Context applies separate per-diff, aggregate-diff, and overall Context token budgets.

## 7. Database / Migration

No destructive or schema-replacement migration was necessary.

`worklog_events` already stores an extensible `event_type` plus JSON payload, so `code_diff` is an additive event type. Existing database rows remain readable, the established additive schema initialization remains intact, and packaged verification confirms persisted Context retrieval after a backend restart.

## 8. Tests and Build Verification

| Area | Result |
|---|---|
| Python tests | `72 passed` |
| TypeScript extension tests | `64 passed`, `1 skipped` existing packaged-backend test |
| TypeScript lint | Passed |
| TypeScript compile | Passed |
| VSIX package | Passed: `ai-worklog-assistant-0.1.1.vsix` |
| Packaged backend smoke | Passed |
| Packaged Stage 12A C++ pipeline | Passed |
| Packaged backend lifecycle | Passed |
| Bundled/backend SHA-256 | Equal: `771441D187B36CF0E0156A5EBB9681663374BF162C1A3E2BF497FD9CBA59F676` |
| Owned backend cleanup | Passed; no residual owned process |

The Pydantic v1-validator deprecation messages are inherited warnings; they are not test failures or Stage 12A regressions.

Known non-blocking gap: the pre-existing Stage 6 Extension Host startup issue remains classified as non-blocking. It was not treated as a Stage 12A product failure; the deterministic packaged-backend integration path passed.

## 9. Demo Evidence

The deterministic C++ scenario verified the stored and contextualized patch:

```diff
-std::cout << greet(userName) << std::endl;
+std::cout << greet("World") << std::endl;
```

The packaged verification confirmed all of the following:

- `STAGE12_PACKAGED_CODE_DIFF=PASS`
- `CODE_DIFF_CONTEXT=PASS`
- `CODE_DIFF_EVIDENCE=PASS`
- `RESTART_RECOVERY=PASS`
- `OWNED_BACKEND_CLEANUP=PASS`

## 10. Remaining Issues

### Blocking

None.

### Non-blocking

The inherited Stage 6 Extension Host startup gap remains documented separately from Stage 12A.

### Future Stage 12B+

Terminal command capture, semantic/AST diffs, broader Context v2 work, and Summary-quality redesign remain intentionally out of scope.

## 11. Manual UI Acceptance Needed

1. Install `apps/vscode-extension/ai-worklog-assistant-0.1.1.vsix` in VS Code.
2. Start a Task and save a C++ file after replacing `userName` with `"World"`.
3. End the Task and inspect the AI Context preview for `code_diffs` and the patch.
4. With a configured test or production Summary provider, confirm a `code_changes` entry can cite the displayed “代码差异” Evidence.
