# AI Worklog Assistant Phase 1 Packaging

## Product version

- Git commit: `a881a7ba83229937c3b24de0024919a59ef51598`
- Stage 11B tag: `stage-11-semantic-rag` (`6960104657c61af36f51aadea671571d1e67bb76`)
- Extension version: `0.1.1`

## Post-packaging compatibility update

- Extension fix commit: `450e9376d150a2a27590d7345dd031c505e7cd3f`
- The AI connection test now limits its short test request to 32 output tokens while retaining the configured 2048-token budget for Summary and RAG generation.
- Updated VSIX SHA-256: `BBCA549F3CC9602CCFA891F9EFD2ED2CEAB51FA1846F4219A0A7EFB0FFE97695`
- Original Source ZIP SHA-256: `E04C9ED06ACAC3D2494BD6BB7CC331C1714A3B9E94AFA72F97B0BC7764E6762A`

## VSIX

- File: `package/ai-worklog-assistant-0.1.1.vsix`
- Bundled backend: `server/ai-worklog-server.exe`
- Content audit: manifest, compiled entry, icon, license, and backend present; 46 archive entries; no test JS, source maps, `.env`, database, logs, Python environment, or node_modules.
- Install validation: passed in a dedicated VS Code extensions directory; identified as `wuhuan818.ai-worklog-assistant@0.1.1`.

## Source files

- Directory: `source/AI-Worklog-Assistant-Source/`
- The source was built deterministically from Git-tracked source and build configuration. The verified Source ZIP was extracted directly into the submission directory for easier review; the ZIP itself is not included.
- The source does not contain the packaged backend. The installable VSIX is the single release artifact containing it, avoiding duplicate binaries while keeping the source rebuildable.
- Excludes Git metadata, dependencies, virtual environments, runtime databases, generated knowledge, logs, build intermediates, `.env`, and previous submission outputs.

## Verification

- Python tests, TypeScript compile, lint, and unit tests: passed (`scripts/verify.ps1`).
- Stage 9 and packaged summary route verification: passed.
- Stage 11A knowledge retrieval and Stage 11B semantic RAG packaged verification: passed.
- Packaged backend health, capability coverage, restart, shutdown, and lifecycle verification: passed.
- Workspace and bundled backend SHA-256 values match.
- Isolated VSIX CLI installation: passed.
- Stage 6 data continuity Extension Host E2E: failed before test execution with `Phase one Extension Host exited 1`; its preserved diagnostic has no extension-host log or product assertion failure. This is an environment/harness limitation in the current desktop session and does not affect the successful packaged backend or isolated installation checks.
- Owned backend processes after verification: `0`.

## Security audit

- No API key, authorization value, SecretStorage content, `.env`, user database, real knowledge content, provider response, reasoning content, or runtime log is included.
- The source audit permits only generic/synthetic Windows paths used by privacy tests and rejects the submitter's actual account path.

## Known non-blocking gap

There is no Published Knowledge in the product profile used for manual acceptance. Positive UI knowledge-hit and citation-click flows were not manually exercised; automated Fake Provider and packaged EXE paths passed.

## Minimal manual UI acceptance

1. In VS Code choose **Extensions: Install from VSIX** and select the VSIX in `package`.
2. Confirm **AI Worklog** appears in the Activity Bar.
3. Open the sidebar and a basic command; confirm no backend-start error.
4. Close VS Code. A process check should show no owned `ai-worklog-server.exe`.
