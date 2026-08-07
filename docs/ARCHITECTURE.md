# 架构

VS Code 插件通过 `127.0.0.1` HTTP JSON API 访问 FastAPI。本地服务拥有 SQLite 事务边界和 Markdown 知识输出；插件负责 UI、VS Code 生命周期事件和 SecretStorage。Mock Provider 使无网络/无密钥时仍可演示。

主流程：开始任务 → 事件入库 → Bug/备注管理 → 结束任务 → 生成草稿 → Webview 编辑确认 → SQLite 状态更新与 Markdown 幂等写入 → 关键词检索。
# Stage 06 continuity boundary

The extension owns a stable global-storage data directory and passes it
explicitly to every backend process. Workspace identity resolution occurs only
after the backend is healthy; event capture is enabled only after a matching
active task has been restored.

## Stage 07 AI provider boundary

Provider profiles are extension-owned user configuration. Profile metadata is stored in VS Code `globalState`; the API key is read only from `SecretStorage` under `aiWorklog.aiProvider.<profile-id>.apiKey`. The local FastAPI service is stateless for connection checks: it receives a key only for that request and does not persist it to SQLite, logs, or responses. Connection tests use a fixed synthetic prompt and never include work items, Bugs, events, notes, source, or diffs. Summary generation remains outside Stage 07.

## Stage 07.1 backend ownership boundary

Every activation has a UUID instance ID and each backend launch has a generation. The extension writes a non-secret runtime registration under global storage, requests authenticated loopback shutdown during `deactivate()`, and permits a bounded PID-tree fallback only for its tracked child. Startup cleanup removes stale registrations and only terminates an orphan when its PID, executable path, process start time, and dead Extension Host parent all match.

## Stage 08 AI context boundary

The local server builds immutable `task-context-package/v1` snapshots only from already persisted work records. Context modules normalize paths, redact before budgeting, sort/deduplicate deterministically, calculate a local token estimate and store only sanitized JSON in SQLite. The extension is a local preview/Ready client: it never sends a package to a Provider or reads an API key. No Stage 08 flow scans a workspace, reopens a file, reads terminal history, environment variables, or SecretStorage.

## Stage 08 AI context boundary

The local server builds immutable `task-context-package/v1` snapshots only from already persisted work records. Context modules normalize paths, redact before budgeting, sort/deduplicate deterministically, calculate a local token estimate and store only sanitized JSON in SQLite. The extension is a local preview/Ready client: it never sends a package to a Provider or reads an API key. No Stage 08 flow scans a workspace, reopens a file, reads terminal history, environment variables, or SecretStorage.

## Stage 08 AI context boundary

The local server builds immutable `task-context-package/v1` snapshots only from already persisted work records. Its context modules normalize paths, redact before budgeting, sort/deduplicate deterministically, calculate a local token estimate and store only sanitized JSON in SQLite. The extension is a local preview/Ready client: it never sends a package to a Provider or reads an API key. No Stage 08 flow scans a workspace, reopens a file, reads terminal history, environment variables, or SecretStorage.

## Stage 09 AI summary boundary

The generation service reads one persisted Ready Context Package by ID and submits only that sanitized snapshot through the selected Provider adapter. It validates `ai-summary-draft/v1`, evidence provenance, paths, output redaction and bounded fields locally before immutable draft persistence. Provider keys are temporary extension-to-server request material; jobs and drafts retain neither keys, Authorization, raw prompts/responses, nor reasoning. The extension owns confirmation, SecretStorage access, status polling, cancellation, and the read-only draft panel.
# Stage 11A retrieval layer

The local backend owns a persistent `knowledge_search_index` derived exclusively from current `knowledge_publications`. On startup it reconciles legacy published rows; publication updates force a deterministic rebuild. The VS Code Sidebar and Command Palette call `GET /knowledge/search`, then open the returned managed Markdown logical path only after verifying it resolves beneath the managed knowledge root. Retrieval remains entirely local and does not invoke an AI Provider.
