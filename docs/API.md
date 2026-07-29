# API

除 `/health` 外均使用 `Authorization: Bearer <session-token>`。错误返回 FastAPI JSON 错误结构。

核心接口：`POST /session/initialize`、`GET/POST /projects`、`POST /tasks`、`POST /tasks/{id}/end`、`POST /events`、`POST /tasks/{id}/bugs`、`POST /bugs/{id}/resolve`、`POST /tasks/{id}/summaries/generate`、`GET /tasks/{id}/summaries/latest`、`PUT /summaries/{id}`、`POST /summaries/{id}/confirm`、`GET /knowledge/search?q=`。
