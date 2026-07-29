# v0.1.1-verification 报告

## 范围

本版本只验证 v0.1.0 已声明的任务、事件、Bug、Mock AI、审核确认、Markdown 和检索闭环，不实现真实模型、Embedding/RAG、飞书、完整终端输出或离线队列。

## 自动验证结果

| 项目 | 结果 | 证据 |
|---|---|---|
| FastAPI 健康检查 | 通过 | `python -m pytest apps/local-server/tests -q`，7 passed |
| Token 校验 | 通过 | 后端测试 `test_session_token_is_required`；打包 smoke `TOKEN_CHECK=PASS` |
| 项目/任务/事件 | 通过 | 后端测试覆盖创建项目、任务和事件 |
| Bug 创建/解决 | 通过 | 后端测试覆盖 active → resolved |
| Mock AI 草稿 | 通过 | 生成、更新、确认和状态转换测试 |
| Markdown 与关键词检索 | 通过 | 确认后生成文件并搜索匹配内容 |
| 敏感信息过滤 | 通过 | api_key、password、token 和 sk-* 测试 |
| API Client | 通过 | `npm.cmd test`，3 tests passed |
| TypeScript compile | 通过 | `npm.cmd run compile` |
| TypeScript lint | 通过 | `npm.cmd run lint` |
| PyInstaller | 通过 | `artifacts/backend/ai-worklog-server.exe` 已生成 |
| 打包后端 smoke | 通过 | `PACKAGED_BACKEND_SMOKE=PASS`、`HEALTH=PASS`、`USER_DATA_DIR=PASS` |

## 尚需人工验证

- 在真实 VS Code Extension Development Host 中验证 VS Code API、Activity Bar、状态栏、文件保存监听和 Webview。
- 验证插件实际定位 `server/ai-worklog-server.exe`、后端异常提示、重启和 VS Code 关闭时子进程清理。
- 验证 Windows 安装环境中的 VSIX 打包和首次启动体验。

## 构建产物

- 本地验证产物：`artifacts/backend/ai-worklog-server.exe`，属于运行时构建产物，不提交 Git。
- 扩展打包前由 `scripts/build-extension.ps1` 复制后端到 `apps/vscode-extension/server/`；真实 VSIX 安装仍需人工确认。

## 结论

后端闭环、打包后端健康检查和可自动测试的扩展服务层已验证通过；VS Code 宿主集成仍保持“待人工验证”，没有将其误报为自动通过。
