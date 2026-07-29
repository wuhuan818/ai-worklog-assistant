# 技术决策

- 采用 SQLite 原生 SQL，减少 3～5 天样板的迁移依赖；启动时幂等建表。
- 首版使用固定本地用户 `local-user`，保留 `user_id` 字段，不引入登录。
- 默认 Mock AI，真实供应商只预留统一配置，确保无密钥也能完成演示。
- 采用固定端口 `8765` 简化插件启动；服务只绑定回环地址并要求 Bearer Token。
- 首版将 VS Code 保存事件作为稳定的修改粒度；Shell Integration 和复杂 Debug 输出降级为后续能力。
