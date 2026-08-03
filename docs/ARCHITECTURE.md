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
