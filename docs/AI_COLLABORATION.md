# AI 协作记录

本项目由 Codex 辅助生成和推进。当前版本中，Codex 完成了项目骨架、FastAPI/SQLite 本地服务、VS Code 插件基础实现、共享契约、Mock 总结与 Markdown 知识库、测试、脚本和交付文档。

需要人工验证的部分包括：在真实 VS Code Extension Development Host 中运行插件、验证 Windows 下本地服务生命周期、Shell Integration/Task/Problems/Debug 事件采集，以及真实模型配置和 VSIX 安装。

当前尚未验证或未实现的能力包括：PyInstaller 发布后自动启动、完整终端输出捕获、精确代码 Diff、Embedding/RAG、飞书同步、离线队列和多用户登录。

后续版本应通过 GitHub 的 `main` 稳定分支、`develop` 开发分支、版本标签和代码审阅 Issue 逐轮审阅和迭代。
