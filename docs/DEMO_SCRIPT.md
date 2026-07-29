# v0.1.1-verification 演示脚本

1. 执行 `scripts/build-backend.ps1`，再执行 `scripts/build-extension.ps1`。
2. 在 VS Code 中按 F5 启动 Extension Development Host，确认 AI Worklog Activity Bar 出现。
3. 执行 `AI Worklog: Start Task`，输入“验证登录校验”。
4. 保存一个文件，创建 Bug，添加备注，再解决 Bug。
5. 执行 `AI Worklog: End Task`，确认生成 Mock 草稿并审核确认。
6. 展示用户数据目录中的 SQLite 和 Markdown，并搜索任务关键词。
7. 结束后端进程，执行 `AI Worklog: Restart Local Server`，展示错误提示和恢复结果。
8. 关闭 Extension Development Host，使用任务管理器确认后端子进程已清理。

自动验证可执行：`scripts/verify.ps1`。其中 VS Code 宿主步骤仍必须人工完成。
