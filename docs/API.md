# API

除 `/health` 外均使用 `Authorization: Bearer <session-token>`。错误返回 FastAPI JSON 错误结构。

核心接口：`POST /session/initialize`、`GET/POST /projects`、`GET /tasks/active`、`POST /tasks`、`GET /tasks/{id}`、`POST /tasks/{id}/end`、`POST /events`、`POST /tasks/{id}/bugs`、`POST /bugs/{id}/resolve`、`POST /tasks/{id}/summaries/generate`、`GET /tasks/{id}/summaries/latest`、`PUT /summaries/{id}`、`POST /summaries/{id}/confirm`、`GET /knowledge/search?q=`。

`POST /projects` 接收 `name` 和可选 `workspace_path`，同用户同标准化名称/Workspace 幂等返回已有项目。`POST /tasks` 接收 `name`、`project_id`（或兼容旧的 `project`）及可选描述、需求编号、标签；已有活动任务返回 HTTP 409。`GET /tasks/active` 始终返回 `{ "task": <完整任务对象或 null> }`；无活动任务是 HTTP 200 正常空状态。指定任务 ID 不存在时，`GET /tasks/{id}` 和结束接口仍返回 HTTP 404。结束任务返回 `status=completed`、后端生成的 `ended_at` 和 `duration_seconds`；重复结束返回 409。

阶段 4 事件接口：批量接口接收 `{events:[{client_event_id,event_type,source,workspace_path?,file_path?,occurred_at,payload}]}`，最多 100 条；重复客户端 ID 返回 `duplicates` 而不重复插入。事件必须属于 `local-user` 的活动任务。查询返回 `{items,total,limit,offset}`，limit 为 1-500，稳定按 sequence/时间排序；摘要返回 `total`、`by_type`、`latest_event_at`。完成任务写入返回 409。

## 阶段 5：Bug 生命周期

Bug 仅属于当前 `local-user` 的同一项目、同一任务。接口为 `GET/POST /tasks/{task_id}/bugs`、`GET /tasks/{task_id}/bugs/current`、`GET /tasks/{task_id}/bugs/{bug_id}`，以及 `POST` 到该 Bug 的 `/activate`、`/pause`、`/resolve`、`/reopen`。列表支持 `status`、`severity`、`limit`、`offset`，返回 `{items,total,limit,offset}`；`current` 在没有活动 Bug 时返回 HTTP 200 `{bug:null}`。

创建请求要求 `title` 与 `severity`，可选 description/category/source/external_reference/tags；默认 `open`。activate 会在一个事务中暂停原 active Bug，并激活 open/paused 目标。pause 仅允许 active；resolve 要求非空 `resolution_summary`，可选 `root_cause`、`verification`；reopen 仅允许 resolved 并变为 open。状态或已完成任务不可修改时返回 409，字段校验返回 422。

备注接口为 `GET/POST /tasks/{task_id}/bugs/{bug_id}/notes`；POST 要求幂等 `client_note_id` 和非空、最长 4000 字符的 `text`。`GET /tasks/{task_id}/bugs/{bug_id}/resolutions` 返回完整解决历史，`GET /tasks/{task_id}/bugs/{bug_id}/events` 返回仅归属该 Bug 的事件，均支持稳定分页。事件批量体可选 `bug_id`；它必须属于相同用户和任务，但写入时不要求 Bug 仍为 active，以支持延迟 flush。
# Stage 06

`POST /projects/resolve` atomically finds or creates a project from a versioned
workspace identity and returns `{ project, created, matched_by }`.

## Stage 07: provider connection check

`POST /ai/providers/test-connection` accepts a Provider kind, base URL, model, thinking preference, timeout and an API key supplied by the extension. It performs one bounded, non-streaming completion request containing only a fixed connection-test prompt. It returns a redacted success/error result; keys and provider response bodies are never returned or persisted. Supported Provider kinds are `deepseek`, `qwen`, and `openai-compatible`. DeepSeek sends an explicit `thinking.type` setting, Qwen sends `enable_thinking`, and custom providers use standard OpenAI-compatible completion fields.
