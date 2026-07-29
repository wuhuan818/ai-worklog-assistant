# 已知限制

- VS Code 宿主中的插件启动、Activity Bar、Webview、文件监听、异常提示、重启和退出清理仍需人工验收。
- 当前插件默认寻找扩展目录下的 `server/ai-worklog-server.exe`；开发环境需先执行后端打包和扩展构建脚本。
- 终端完整输出、Shell Integration、精确代码 Diff 和 Debug Console 原始内容尚未实现。
- 默认 Mock Provider；真实模型、Embedding/RAG、飞书同步和离线队列未实现。
- 审核 Webview 仍使用可编辑 JSON 文本，未进行大规模 UI 美化。
- GitHub Actions 已配置，但需要远程 PR 工作流实际运行后再确认云端 Windows runner 结果。
