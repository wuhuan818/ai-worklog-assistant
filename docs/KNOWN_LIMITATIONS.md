# 已知限制

- VS Code 宿主中的 F5、Activity Bar、Webview、文件监听、异常提示、重启和退出清理仍需一次 GUI 人工验收；后端生命周期已有单元测试、真实 EXE 集成测试和 Windows 集成脚本。
- OutputChannel 和 `context.logUri/ai-worklog.log` 已由代码和测试覆盖，但最终 GUI 下拉列表、查看日志按钮和错误提示仍需人工确认。
- 开发环境需先执行后端打包；插件会优先解析配置路径，其次解析 workspace 根目录下的 `artifacts/backend/ai-worklog-server.exe`，并兼容扩展目录下的 `server/ai-worklog-server.exe`。
- 终端完整输出、Shell Integration、精确代码 Diff 和 Debug Console 原始内容尚未实现。
- 默认 Mock Provider；真实模型、Embedding/RAG、飞书同步和离线队列未实现。
- 审核 Webview 仍使用可编辑 JSON 文本，未进行大规模 UI 美化。
- GitHub Actions 已配置，但需要远程 PR 工作流实际运行后再确认云端 Windows runner 结果；本地 Windows 三轮真实 EXE 验证已通过。
- 阶段 3 当前仅允许单个活动任务；重复结束返回 409，项目重复创建在同名同 Workspace 时幂等。
- 真实集成脚本依赖 Windows 可执行文件和 PowerShell；脚本已使用有界 deadline、PID 基线和 finally 清理，不应直接复用为用户进程管理工具。
- 已解决：全新 Workspace 无活动任务时的 `Task not found` 同步误报；活动任务接口现返回稳定 `{task:null}` 空结果，F5 预启动会同步最新后端。
阶段 4 的事件缓冲仅存在于扩展进程内；异常退出可能丢失尚未发送的事件。终端命令/输出、完整 Diff、Debug 变量和 Task 输出不采集。真实 VS Code Task/Debug 的完整自动触发依赖测试 Workspace，核心采集器通过可注入/公开 API 契约验证。
F5 后端自动启动回归已修复：根因是激活流程缺少 `ServerManager.start()` 调用，当前由激活协调器自动发起，且不依赖侧边栏可见性；仍需用户完成一次真实 Extension Development Host 人工确认。

已解决：AI Worklog 侧边栏重新显示后状态回退为“启动中”。View 现在从 ServerManager 当前状态刷新，视图生命周期不会停止或重置后端，旧异步渲染会被版本号丢弃。

阶段 5 仍使用固定 `local-user`，不提供跨设备同步、协作分配、GitHub Issue 同步、自动分类或相似 Bug 匹配。Bug 描述、备注与解决内容受长度限制，并且日志只记录 ID、状态和计数，不记录全文。扩展进程异常退出前尚未 flush 的事件仍可能丢失；已入 Buffer 的 Bug ID 不会被后续切换改变。
# Resolved: intermittent Bug button flicker

The sidebar previously mixed timer refreshes with independent backend/task/Bug button writes.  It now uses a fingerprinted state snapshot and timer-only updates; this is covered by the Bug Button Stability E2E.
# Stage 06

Possible moved workspaces are not silently rebound. The user must explicitly
choose any future rebinding workflow; current identity safety favors isolation.

## Stage 07 scope boundary

Stage 07 establishes secure Provider configuration and synthetic connection checks only. It does not call a real paid Provider during automated tests, send task/Bug/event/note/source/diff data, generate work summaries, implement RAG/embeddings, or add automatic cross-provider fallback. Real DeepSeek and Qwen credentials remain a final human acceptance check. The prior Windows Extension Host `code 1` path-splitting issue is resolved by the pinned 1.85.2 launcher using `shell: false`; it is not a current product limitation.
## Stage 7 backend shutdown stability

In some VS Code shutdown paths, the extension-owned local backend could survive after the Extension Host exited. This Stage 7 known blocker is **Resolved in stage 7.1** through an awaited shutdown path, authenticated server exit endpoint, parent-process watchdog, and per-instance runtime ownership record. Residual risks still require the dedicated Extension Host and packaged-EXE acceptance runs documented in Stage 7.1.

## Stage 08 boundary and inherited evidence gaps

Context Package v1 is deliberately a local preview/Ready snapshot only: it does not call an AI Provider, generate a summary, export Markdown, use RAG, or read source files beyond already persisted records. Token counts are estimates, not provider billing counts, and captured diffs may be unavailable or truncated by privacy/budget rules.

The Stage 7.1 direct Reload Window automated regression and independent startup orphan-cleanup integration evidence are still not available. Stage 08 inherits and documents those gaps; it does not claim they are resolved or widen its smoke test into a lifecycle E2E.

## Stage 09 scope boundary

Stage 09 is summary-draft generation only. It deliberately does not offer draft editing, approval/rejection, regeneration UI, Markdown export, knowledge-base writes, embeddings, RAG, agents, web search, provider auto-selection, or cross-provider fallback. Automated verification uses a Fake Provider; a real Provider call remains a manual acceptance check and must use the user's locally stored key.
