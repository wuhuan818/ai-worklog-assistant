# 数据模型

启动时创建并迁移 `users`、`projects`、`tasks`、`bugs`、`events`、`summary_drafts`、`knowledge_entries`。项目增加 `workspace_path`、`normalized_name`、`created_at`、`updated_at`；任务增加 `duration_seconds`、`created_at`、`updated_at`。阶段 3 任务状态为 `active/completed/cancelled`；旧 `review/confirmed` 数据仍可读取。活动任务使用用户维度部分唯一索引。
# 阶段 4 事件

`worklog_events` 表包含 `id`、唯一 `client_event_id`、`user_id`、`task_id`、`event_type`、`source`、`workspace_path`、`file_path`、UTC `occurred_at`、后端生成的 UTC `created_at`、任务内 `sequence` 和 JSON `payload_json`。迁移只新增表和索引，不删除现有项目、任务或用户数据。
