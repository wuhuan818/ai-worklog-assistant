# VS Code AI 工作记录助手

一个面向 Windows 的 VS Code 本地工作记录样板：任务、Bug、代码/诊断事件、Mock AI 总结、SQLite 持久化、Markdown 知识库和关键词搜索形成完整演示闭环。

## 架构

- `apps/local-server`：FastAPI + SQLite 本地服务，默认只监听 `127.0.0.1`。
- `apps/vscode-extension`：TypeScript VS Code 插件；侧边栏、命令、状态栏和本地服务客户端。
- `packages/shared-contracts`：跨端事件与总结类型/JSON Schema。
- `knowledge`：确认后的日报与项目知识文档。

## 开发

要求 Python 3.11+、Node.js 18+、VS Code 1.85+。

```powershell
.\scripts\setup.ps1
.\scripts\test.ps1
.\scripts\dev.ps1
.\scripts\verify.ps1
```

`verify.ps1` 执行后端测试、扩展 compile/lint/test、PyInstaller 打包和打包后端 smoke。运行时数据默认位于 `%LOCALAPPDATA%\AIWorklogAssistant`，后端产物位于 `artifacts/backend/ai-worklog-server.exe`。

模型配置通过插件设置 `aiWorklog.baseUrl`、`aiWorklog.model`、`aiWorklog.enabled`，密钥使用 SecretStorage。未配置模型时使用 Mock Provider。

## 演示与验证

执行 `docs/DEMO_SCRIPT.md`。人工逐步验收见 `docs/MANUAL_TEST_CHECKLIST.md`，自动验证结果见 `docs/VERIFICATION_REPORT.md`。

## 限制

终端 Shell Integration、真实模型、语义检索、飞书、离线队列和 VS Code 宿主的真实生命周期仍分别按 `docs/KNOWN_LIMITATIONS.md` 标注处理。
# Stage 11A: local knowledge retrieval

Published knowledge can be searched from the AI Worklog Sidebar’s **搜索知识** button or the `AI Worklog: Search Knowledge Base` command. Search is local, works for Chinese/English terms, and opens the managed Markdown source. Embedding, semantic search, and AI RAG answers remain future work.
