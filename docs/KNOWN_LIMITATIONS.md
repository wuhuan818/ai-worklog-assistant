# 已知限制

- 当前插件开发版连接已运行的本地服务；尚未自动管理 PyInstaller 子进程。
- 当前环境未安装 PyInstaller，因此尚未生成 Windows 后端可执行文件。
- 终端完整输出、Shell Integration、Debug Console 原始内容和精确 Diff 尚未做深度采集。
- 默认 Mock Provider；OpenAI 兼容真实调用、Embedding/RAG、飞书同步和离线队列未实现。
- 审核 Webview 使用可编辑 JSON 文本，后续可替换为分区表单。
