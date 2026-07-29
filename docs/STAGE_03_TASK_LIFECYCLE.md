# 阶段 3：项目与任务生命周期

## 目标与实际实现

本阶段实现单用户模式下的项目创建/选择、任务开始/结束、SQLite 持久化、单活动任务约束、后端重启恢复和侧边栏计时。固定用户为 `local-user`，后端生成 UTC ISO 8601 时间，插件按本地时区显示。

项目支持名称、Workspace 路径、创建/更新时间；同一用户的标准化名称和 Workspace 组合幂等。任务支持描述、需求编号、去重标签、状态、开始/结束时间和后端计算的秒数。旧事件、Bug、总结接口保留兼容，但结束任务不再生成总结。

## API 与恢复

新增/完善 `GET /projects`、`POST /projects`、`GET /tasks/active`、`POST /tasks`、`GET /tasks/{id}`、`POST /tasks/{id}/end`，详见 [API.md](API.md)。数据库启动时以幂等迁移补列，并用活动任务部分唯一索引和 `BEGIN IMMEDIATE` 防止并发重复开始。插件激活、后端健康、重启健康、刷新时均从后端查询活动任务。

## 计时、测试与验收

侧边栏每秒根据同一 `started_at` 更新显示，Provider dispose 时清理定时器；结束时只采用后端 `duration_seconds`。运行 `python -m pytest apps/local-server/tests -q`、`apps/vscode-extension` 下的 `npm.cmd run compile; npm.cmd run lint; npm.cmd test`，以及 `scripts/verify-task-lifecycle.ps1` 完成自动和 EXE 集成验证。

人工只需按 F5，等待后端正常，创建项目并开始任务，等待约 10 秒，点击重启后端确认开始时间和计时保持，结束任务确认时长，然后重开 Extension Development Host 确认无活动任务且 SQLite 中仍有历史数据。

## 未完成项

本阶段不实现事件采集扩展、Bug/AI/Markdown/知识库新增能力；这些既有接口仅保持兼容。
