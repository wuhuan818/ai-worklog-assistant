# 数据模型

启动时创建并迁移 `users`、`projects`、`tasks`、`bugs`、`events`、`summary_drafts`、`knowledge_entries`。项目增加 `workspace_path`、`normalized_name`、`created_at`、`updated_at`；任务增加 `duration_seconds`、`created_at`、`updated_at`。阶段 3 任务状态为 `active/completed/cancelled`；旧 `review/confirmed` 数据仍可读取。活动任务使用用户维度部分唯一索引。
# 阶段 4 事件

`worklog_events` 表包含 `id`、唯一 `client_event_id`、`user_id`、`task_id`、`event_type`、`source`、`workspace_path`、`file_path`、UTC `occurred_at`、后端生成的 UTC `created_at`、任务内 `sequence` 和 JSON `payload_json`。迁移只新增表和索引，不删除现有项目、任务或用户数据。

# 阶段 5 Bug

`bugs` 保存 user/project/task 归属、标题、可选描述和分类字段、severity、JSON tags、状态时间、`active_started_at` 与累计 `total_active_seconds`。状态为 `open`、`active`、`paused`、`resolved`；`task_id WHERE status='active'` 的部分唯一索引是后端的最终单 current Bug 约束。

`bug_notes` 保存唯一 `client_note_id`、Bug/task/user、备注文本和 UTC 创建时间。`bug_resolutions` 为每次解决新增一行，保存摘要、可选根因/验证和 UTC 创建时间；reopen 不删除历史。`worklog_events.bug_id` 是可空、可索引的迁移列，旧事件保持 null。所有迁移仅补充结构和索引，保留已有 SQLite 数据。
