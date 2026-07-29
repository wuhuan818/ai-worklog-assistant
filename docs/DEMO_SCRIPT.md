# 演示脚本

1. 运行 `scripts/dev.ps1`，按 F5 启动插件。
2. 执行 `AI Worklog: Start Task`，输入“修复登录校验”，项目使用当前 Workspace。
3. 修改并保存一个 TypeScript/Python 文件；执行一次 `pytest`；创建 Bug“Token 校验失败”；添加备注；修复后执行 Resolve Bug。
4. 执行 `AI Worklog: End Task`，在审核页面调整摘要并确认。
5. 展示 `worklog.db`、`knowledge/daily-records` 和 `knowledge/projects`，搜索“登录”。
