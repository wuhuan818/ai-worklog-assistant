# 阶段 4：事件采集与持久化

本阶段将 VS Code 开发行为关联到当前活动工作任务，并写入本地 SQLite。支持的事件为 `file_changed`、`file_saved`、`diagnostics_changed`、VS Code Task 生命周期、Debug Session 生命周期和 `manual_note`。

事件只在存在活动任务时产生；后端只接受活动任务的新事件，完成任务的迟到写入返回 409。事件使用 `client_event_id` 幂等，批量最多 100 条，payload 最大 256 KB。路径优先使用 Workspace 相对路径，`.git`、`node_modules`、构建目录、虚拟环境和常见二进制扩展名被排除。不会采集文件全文、完整 Diff、终端输出、Task 命令、Debug 变量/调用栈、Token、Secret 或环境变量。

扩展使用最多 500 条的内存缓冲，每 2 秒或达到 50 条发送；备注立即发送，任务结束前 flush。进程异常退出时未发送内存事件可能丢失，持久化离线队列不属于本阶段。已发送事件和摘要来自后端 SQLite，后端重启后可继续查询。

API：

- `POST /tasks/{task_id}/events/batch`
- `GET /tasks/{task_id}/events?limit=&offset=&event_type=`
- `GET /tasks/{task_id}/events/summary`

自动测试覆盖后端迁移、事务、幂等、过滤、摘要和活动任务约束，以及扩展编译、API 类型和缓冲核心逻辑。最终人工验收：仓库根目录按 F5（Extension Development Host 会自动启动，无需再次选择配置），开始任务后修改并保存文件、制造并修复一个 Diagnostics、运行 Task、启动/停止 Debug、添加备注、刷新并查看最近事件，重启后端确认历史仍在，最后结束任务。
