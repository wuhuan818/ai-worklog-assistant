# 阶段 2：后端生命周期

## 实际实现

- `apps/vscode-extension/src/backendPath.ts` 从配置、workspace 根目录和 extension context 解析 `artifacts/backend/ai-worklog-server.exe`；不存在时列出已检查路径并报错。
- `apps/vscode-extension/src/backendProcessManager.ts` 独立负责随机会话 token、端口、用户数据目录、`spawn`、stdout/stderr、PID、重复启动保护、健康轮询、停止、重启和异常退出状态。
- `apps/vscode-extension/src/serverManager.ts` 将 VS Code 配置、用户可写数据目录和 `AI Worklog` OutputChannel 接入进程管理器。
- 侧边栏通过状态事件和 Webview 消息自动显示 `启动中`、`正常`、`异常`、`停止中`、`已停止`，无需重新打开视图。
- `deactivate()` 只停止当前扩展保存的子进程；停止过程使用该子进程句柄，不按进程名终止其他程序。
- 日志仅写入 VS Code 的 `AI Worklog` OutputChannel，输出路径、时间、PID、端口、健康结果、退出码和错误摘要，并对 token、API key、secret、password 做脱敏。

## 自动验证

在仓库根目录执行：

```powershell
Push-Location apps/vscode-extension
npm.cmd run compile
npm.cmd run lint
npm.cmd test
Pop-Location
python -m pytest apps/local-server/tests -q
powershell.exe -ExecutionPolicy Bypass -File scripts/verify-backend-lifecycle.ps1
```

插件测试覆盖路径解析、状态机、token 传递与日志脱敏，以及启动、重复启动、启动失败、健康超时、停止、重启和异常退出。生命周期脚本会构建 PyInstaller EXE，使用临时用户数据目录完成两次启动、健康检查、token 拒绝/接受、停止和数据保留验证。

## 当前未完成项

- 本阶段不实现真实模型、Embedding/RAG、飞书同步、离线队列或完整终端输出捕获。
- VS Code Extension Development Host 的 GUI 操作仍不是自动化测试的一部分。

## 用户最后一次人工验证

从仓库根目录打开 VS Code，按 F5 选择 `Run AI Worklog Extension`，打开 AI Worklog 侧边栏，点击“启动后端”，确认状态从“启动中”变为“正常”；随后执行“AI Worklog: Restart Local Server”，确认状态再次恢复“正常”。这一步只验证 GUI 集成，不替代上述自动测试。
