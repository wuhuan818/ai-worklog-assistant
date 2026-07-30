# 阶段 3：项目与任务生命周期

## 目标与实际实现

本阶段实现单用户模式下的项目创建/选择、任务开始/结束、SQLite 持久化、单活动任务约束、后端重启恢复和侧边栏计时。固定用户为 `local-user`，后端生成 UTC ISO 8601 时间，插件按本地时区显示。

项目支持名称、Workspace 路径、创建/更新时间；同一用户的标准化名称和 Workspace 组合幂等。任务支持描述、需求编号、去重标签、状态、开始/结束时间和后端计算的秒数。旧事件、Bug、总结接口保留兼容，但结束任务不再生成总结。

## API 与恢复

新增/完善 `GET /projects`、`POST /projects`、`GET /tasks/active`、`POST /tasks`、`GET /tasks/{id}`、`POST /tasks/{id}/end`，详见 [API.md](API.md)。数据库启动时以幂等迁移补列，并用活动任务部分唯一索引和 `BEGIN IMMEDIATE` 防止并发重复开始。插件激活、后端健康、重启健康、刷新时均从后端查询活动任务。

## 计时、测试与验收

侧边栏每秒根据同一 `started_at` 更新显示，Provider dispose 时清理定时器；结束时只采用后端 `duration_seconds`。运行 `python -m pytest apps/local-server/tests -q`、`apps/vscode-extension` 下的 `npm.cmd run compile; npm.cmd run lint; npm.cmd test`，以及 `scripts/verify-task-lifecycle.ps1` 完成自动和 EXE 集成验证。

人工只需按 F5，等待后端正常，创建项目并开始任务，等待约 10 秒，点击重启后端确认开始时间和计时保持，结束任务确认时长，然后重开 Extension Development Host 确认无活动任务且 SQLite 中仍有历史数据。

## Windows 真实集成收尾记录

初始验证的真实根因不是 SQLite 或 API，而是 PyInstaller one-file 在 Windows 上启动后会出现同路径的父/子 EXE 进程。旧脚本只保存 `Start-Process` 返回的 `Process` 对象，并在 `taskkill /T` 后等待该对象；子进程仍存活时会造成错误判断或清理阶段卡住。旧脚本还曾使用未读取的 stdout/stderr 重定向，以及 PowerShell 的空 `EnvironmentVariables` 集合，增加了阻塞和兼容性问题。

现已统一使用 `scripts/backend-process-helper.ps1`：记录根 PID、端口和进程树；所有健康/停止等待均使用 deadline；停止先针对本轮根 PID 执行 `taskkill /T /F`，再按本轮启动前的 EXE PID 基线保护无关进程，只清理新增的同路径进程；finally 始终执行有界清理。`verify-sqlite-task.py` 用于直接查询真实 SQLite。

收尾验证结果：阶段 2 `verify-backend-lifecycle.ps1` 连续 3/3 PASS，单轮约 14–16 秒；阶段 3 `verify-task-lifecycle.ps1` 连续 3/3 PASS，单轮约 8–11 秒；每轮均完成重启恢复、任务结束、时长至少 3 秒、SQLite 项目/任务存在及无残留进程检查。辅助脚本 `verify-backend-process-helper.ps1` 覆盖正常停止、重复清理、路径含空格和不清理基线进程。

## 未完成项

本阶段不实现事件采集扩展、Bug/AI/Markdown/知识库新增能力；这些既有接口仅保持兼容。
