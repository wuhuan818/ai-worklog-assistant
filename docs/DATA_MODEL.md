# 数据模型

启动时创建并迁移 `users`、`projects`、`tasks`、`bugs`、`events`、`summary_drafts`、`knowledge_entries`。项目增加 `workspace_path`、`normalized_name`、`created_at`、`updated_at`；任务增加 `duration_seconds`、`created_at`、`updated_at`。阶段 3 任务状态为 `active/completed/cancelled`；旧 `review/confirmed` 数据仍可读取。活动任务使用用户维度部分唯一索引。
