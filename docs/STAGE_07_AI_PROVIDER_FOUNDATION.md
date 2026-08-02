# Stage 07: AI Provider Foundation

AI Provider profiles are stored in VS Code user-level `globalState`; API keys are only stored with VS Code `SecretStorage` under `aiWorklog.aiProvider.<profile-id>.apiKey`. The local SQLite database and extension settings are not used for provider secrets.

The local server exposes `POST /ai/providers/test-connection`. It is stateless: it sends only a fixed synthetic system/user pair, is non-streaming, has a 16-token default cap, bounded timeout and response size, and does not persist, cache, log, or return the key or model response. The client reads the key only immediately before this request.

DeepSeek defaults to `https://api.deepseek.com` and `deepseek-v4-flash`; requests explicitly set `thinking.type` to `disabled` unless thinking is enabled. Qwen defaults to `qwen3.7-plus` and uses `enable_thinking`; custom OpenAI-compatible profiles send only standard completion fields. There is no automatic provider fallback.

Only localhost loopback HTTP endpoints are permitted for development/testing. All remote endpoints must use HTTPS, cannot include credentials, queries, fragments, or a `/chat/completions` suffix.

This stage deliberately does not send task, bug, note, event, source, or diff data to an AI provider and does not implement summary generation.
