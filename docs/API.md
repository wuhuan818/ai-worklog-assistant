# API

除 `/health` 外均使用 `Authorization: Bearer <session-token>`。错误返回 FastAPI JSON 错误结构。

核心接口：`POST /session/initialize`、`GET/POST /projects`、`GET /tasks/active`、`POST /tasks`、`GET /tasks/{id}`、`POST /tasks/{id}/end`、`POST /events`、`POST /tasks/{id}/bugs`、`POST /bugs/{id}/resolve`、`POST /tasks/{id}/summaries/generate`、`GET /tasks/{id}/summaries/latest`、`PUT /summaries/{id}`、`POST /summaries/{id}/confirm`、`GET /knowledge/search?q=`。

`POST /projects` 接收 `name` 和可选 `workspace_path`，同用户同标准化名称/Workspace 幂等返回已有项目。`POST /tasks` 接收 `name`、`project_id`（或兼容旧的 `project`）及可选描述、需求编号、标签；已有活动任务返回 HTTP 409。`GET /tasks/active` 始终返回 `{ "task": <完整任务对象或 null> }`；无活动任务是 HTTP 200 正常空状态。指定任务 ID 不存在时，`GET /tasks/{id}` 和结束接口仍返回 HTTP 404。结束任务返回 `status=completed`、后端生成的 `ended_at` 和 `duration_seconds`；重复结束返回 409。

阶段 4 事件接口：批量接口接收 `{events:[{client_event_id,event_type,source,workspace_path?,file_path?,occurred_at,payload}]}`，最多 100 条；重复客户端 ID 返回 `duplicates` 而不重复插入。事件必须属于 `local-user` 的活动任务。查询返回 `{items,total,limit,offset}`，limit 为 1-500，稳定按 sequence/时间排序；摘要返回 `total`、`by_type`、`latest_event_at`。完成任务写入返回 409。
