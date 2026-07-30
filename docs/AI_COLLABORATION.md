# AI 协作记录

本项目由 Codex 辅助生成和推进。当前版本中，Codex 完成了项目骨架、FastAPI/SQLite 本地服务、VS Code 插件基础实现、共享契约、Mock 总结与 Markdown 知识库、测试、脚本和交付文档。

需要人工验证的部分包括：在真实 VS Code Extension Development Host 中运行插件、Shell Integration/Task/Problems/Debug 事件采集，以及真实模型配置和 VSIX 安装。Windows 本地服务生命周期已由真实打包 EXE 自动验证覆盖。

当前尚未验证或未实现的能力包括：PyInstaller 发布后自动启动、完整终端输出捕获、精确代码 Diff、Embedding/RAG、飞书同步、离线队列和多用户登录。

阶段 3 由 Codex 在阶段 2 基线 `887c0df` 上实现项目/任务生命周期、SQLite 向后兼容迁移、单活动任务约束、插件恢复与计时，并增加后端单元测试、真实 EXE 集成脚本和有界 Windows 进程树辅助函数。收尾诊断确认 PyInstaller one-file 会产生同路径父/子进程；修复后阶段 2、阶段 3 验证各连续三轮通过，且每轮无残留测试进程。本阶段不扩展事件采集、Bug、AI 总结或知识库能力。

后续版本应通过 GitHub 的 `main` 稳定分支、`develop` 开发分支、版本标签和代码审阅 Issue 逐轮审阅和迭代。
阶段 4 由主 Agent 顺序完成，未使用子 Agent；变更集中在事件 API、扩展采集器、缓冲和验证文档。
