# Stage 07: AI Provider Foundation

AI Provider profiles are stored in VS Code user-level `globalState`; API keys are only stored with VS Code `SecretStorage` under `aiWorklog.aiProvider.<profile-id>.apiKey`. The local SQLite database and extension settings are not used for provider secrets.

The local server exposes `POST /ai/providers/test-connection`. It is stateless: it sends only a fixed synthetic system/user pair, is non-streaming, has a 16-token default cap, bounded timeout and response size, and does not persist, cache, log, or return the key or model response. The client reads the key only immediately before this request.

DeepSeek defaults to `https://api.deepseek.com` and `deepseek-v4-flash`; requests explicitly set `thinking.type` to `disabled` unless thinking is enabled. Qwen defaults to `qwen3.7-plus` and uses `enable_thinking`; custom OpenAI-compatible profiles send only standard completion fields. There is no automatic provider fallback.

Only localhost loopback HTTP endpoints are permitted for development/testing. All remote endpoints must use HTTPS, cannot include credentials, queries, fragments, or a `/chat/completions` suffix.

This stage deliberately does not send task, bug, note, event, source, or diff data to an AI provider and does not implement summary generation.

## Extension Host test infrastructure

Extension Host tests use the fixed VS Code `1.85.2` download (commit `8b3775030ed1a69b13e4f4c628c612102e30a681`), which satisfies the extension's `^1.85.0` engine range and is separate from the user's development installation. Each run uses a unique user-data, extensions, data, and log directory below `artifacts/e2e-diagnostics`.

The prior `code 1` was not an AI provider failure. The restricted host sandbox prevented the test `Code.exe` from reading required user-directory metadata; it must run as an isolated elevated test child. In addition, `@vscode/test-electron` 2.5.2 uses `shell: true` on Windows and splits unquoted paths containing spaces. The test launcher therefore uses the package only to resolve the fixed binary and starts it with `shell: false` and an argument array. The test profile has an empty extensions directory; `--disable-extensions` is intentionally not used because it disables VS Code's extension test runner itself.

`npm.cmd run test:e2e:canary` writes ordered, secret-free markers (`launcher_started` through `suite_completed`) and preserves stdout, stderr and VS Code logs for a failed run. Full Provider E2E uses the same launcher with a fake local provider and a random in-memory synthetic key.
