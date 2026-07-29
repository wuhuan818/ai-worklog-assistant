# 阶段 2：后端生命周期

## 实际实现

- `apps/vscode-extension/src/backendPath.ts` 从配置、workspace 根目录和 extension context 解析 `artifacts/backend/ai-worklog-server.exe`；不存在时列出已检查路径并报错。
- `apps/vscode-extension/src/backendProcessManager.ts` 独立负责随机会话 token、端口、用户数据目录、`spawn`、stdout/stderr、PID、重复启动保护、健康轮询、停止、重启和异常退出状态。
- 启动前会探测配置端口；若端口已被占用，会选择本机可用端口并把实际端口写入日志，避免健康检查误连旧后端。
- 每个子进程拥有独立 generation；旧进程延迟到达的 `exit/error` 事件只记录为 stale event，不得覆盖新进程状态。
- `apps/vscode-extension/src/serverManager.ts` 将 VS Code 配置、用户可写数据目录和 `AI Worklog` OutputChannel 接入进程管理器。
- 侧边栏通过状态事件和 Webview 消息自动显示 `启动中`、`正常`、`异常`、`停止中`、`已停止`，无需重新打开视图。
- `deactivate()` 只停止当前扩展保存的子进程；停止过程使用该子进程句柄，不按进程名终止其他程序。
- `activate()` 一开始创建唯一的 `AI Worklog` OutputChannel，写入 `[activation] AI Worklog extension activated`，并注册 `AI Worklog: Show Logs`。
- 同一个日志适配器同时写入 OutputChannel 和 `context.logUri/ai-worklog.log`；输出路径、时间、PID、端口、健康结果、退出码和错误摘要，并对 token、API key、secret、password 做脱敏。

## 人工问题根因与修复

真实 EXE 使用插件相同的环境变量启动后可持续健康，后端入口、FastAPI/uvicorn、SQLite 初始化和 token/端口变量均正常。人工出现“正常后异常”的根因是生命周期管理的竞态：默认端口可能让新进程的健康检查命中旧进程，且旧进程的 exit 回调没有 generation 隔离，可能覆盖新进程状态。现已通过启动前端口探测、generation 校验和 Windows PID 树清理修复。

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

插件测试覆盖 OutputChannel/激活契约、持久日志、路径解析、状态机、token 传递与日志脱敏，以及启动、重复启动、启动失败、健康超时、停止、重启、异常退出和旧 generation 隔离。设置 `AI_WORKLOG_BACKEND_EXE` 后，真实集成测试使用打包 EXE 连续健康 5 秒，重启后再连续健康 5 秒，验证 PID 变化、日志文件、停止和无残留进程。生命周期脚本会构建 PyInstaller EXE，使用临时用户数据目录完成两次启动、健康检查、token 拒绝/接受、停止和数据保留验证。

## 当前未完成项

- 本阶段不实现真实模型、Embedding/RAG、飞书同步、离线队列或完整终端输出捕获。
- VS Code Extension Development Host 的 GUI 操作仍不是自动化测试的一部分。

## 用户最后一次人工验证

从仓库根目录打开 VS Code，按 F5 选择 `Run AI Worklog Extension`，打开 AI Worklog 侧边栏，点击“启动后端”，确认状态从“启动中”变为“正常”；随后执行“AI Worklog: Restart Local Server”，确认状态再次恢复“正常”。这一步只验证 GUI 集成，不替代上述自动测试。
