# Changelog

## Stage 10A

- Added immutable AI summary revisions and persisted approval/rejection history.
- Added Summary Review API and VS Code panel controls for draft/version selection, editing, saving, approving, rejecting, and reload recovery.

## [0.1.1-verification] - 2026-07-29

### Added

- FastAPI 全链路验证测试，覆盖 Token、项目、任务、事件、Bug、Mock 草稿、Markdown、检索和敏感信息过滤。
- 可测试的 VS Code API Client、任务状态转换、错误处理和 Token 请求头。
- GitHub Actions Python、TypeScript、lint、扩展测试和 Windows PyInstaller 构建任务。
- PyInstaller 后端打包、用户可写数据目录和健康检查 smoke 脚本。
- VS Code 后端启动、健康检查、重启和退出清理的服务管理器。
- 人工验收清单和验证报告。

### Known limitations

- VS Code Extension Development Host 的真实启动、异常恢复和进程清理仍需人工验证。

## [0.1.0] - 2026-07-29

### Added

- 初始 Monorepo 项目结构与共享事件契约。
- VS Code 插件基础侧边栏、状态栏、任务命令和文件保存事件提交。
- FastAPI 本地服务、回环地址监听设计、会话 Token 校验和 SQLite 初始化。
- 任务、Bug、事件、Mock AI 草稿、审核确认、Markdown 知识库和关键词检索。
- 后端 API 测试、扩展编译脚本和演示/人工验收文档。

### Known limitations

- 插件当前不会自动管理 PyInstaller 后端子进程。
- 真实模型、完整终端输出、精确 Diff、Embedding/RAG 和飞书同步尚未完成。
- Webview 审核界面目前使用可编辑 JSON 文本。
# Stage 11A

- Added local published-knowledge retrieval, Chinese CJK bigram normalization, ranked search API, Sidebar/Command Palette search, and safe managed-Markdown opening.
- Added automatic index reconciliation and deterministic rebuild; no AI provider, secret, or external search service is used.
# Stage 11B

- Added separate embedding profiles, rebuildable SQLite semantic vectors, cosine semantic retrieval, RRF hybrid retrieval, lexical fallback, and single-turn grounded knowledge answers with citation validation.
