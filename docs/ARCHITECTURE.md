# 架构

VS Code 插件通过 `127.0.0.1` HTTP JSON API 访问 FastAPI。本地服务拥有 SQLite 事务边界和 Markdown 知识输出；插件负责 UI、VS Code 生命周期事件和 SecretStorage。Mock Provider 使无网络/无密钥时仍可演示。

主流程：开始任务 → 事件入库 → Bug/备注管理 → 结束任务 → 生成草稿 → Webview 编辑确认 → SQLite 状态更新与 Markdown 幂等写入 → 关键词检索。
