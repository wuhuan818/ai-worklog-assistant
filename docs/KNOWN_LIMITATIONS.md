# 已知限制

- VS Code 宿主中的 F5、Activity Bar、Webview、文件监听、异常提示、重启和退出清理仍需一次 GUI 人工验收；后端生命周期已有单元测试、真实 EXE 集成测试和 Windows 集成脚本。
- OutputChannel 和 `context.logUri/ai-worklog.log` 已由代码和测试覆盖，但最终 GUI 下拉列表、查看日志按钮和错误提示仍需人工确认。
- 开发环境需先执行后端打包；插件会优先解析配置路径，其次解析 workspace 根目录下的 `artifacts/backend/ai-worklog-server.exe`，并兼容扩展目录下的 `server/ai-worklog-server.exe`。
- 终端完整输出、Shell Integration、精确代码 Diff 和 Debug Console 原始内容尚未实现。
- 默认 Mock Provider；真实模型、Embedding/RAG、飞书同步和离线队列未实现。
- 审核 Webview 仍使用可编辑 JSON 文本，未进行大规模 UI 美化。
- GitHub Actions 已配置，但需要远程 PR 工作流实际运行后再确认云端 Windows runner 结果。
- 阶段 3 当前仅允许单个活动任务；重复结束返回 409，项目重复创建在同名同 Workspace 时幂等。
