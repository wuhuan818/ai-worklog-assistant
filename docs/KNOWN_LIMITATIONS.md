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
