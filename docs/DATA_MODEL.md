# 数据模型

启动时创建 `users`、`projects`、`tasks`、`bugs`、`events`、`summary_drafts`、`knowledge_entries`。事件 payload 使用 JSON 文本保存；草稿保存结构化 JSON。任务状态为 `active/review/confirmed`，Bug 为 `active/resolved`，草稿为 `draft/confirmed/discarded`。
