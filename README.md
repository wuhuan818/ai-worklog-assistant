# VS Code AI 工作记录助手

一个面向 Windows 的 VS Code 本地工作记录样板：任务、Bug、代码/诊断事件、Mock AI 总结、SQLite 持久化、Markdown 知识库和关键词搜索形成完整演示闭环。

## 架构

- `apps/local-server`：FastAPI + SQLite 本地服务，默认只监听 `127.0.0.1`。
- `apps/vscode-extension`：TypeScript VS Code 插件；侧边栏、命令、状态栏和本地服务客户端。
- `packages/shared-contracts`：跨端事件与总结类型/JSON Schema。
- `knowledge`：确认后的日报与项目知识文档。

## 开发

要求 Python 3.11+、Node.js 18+、VS Code 1.85+。

```powershell
.scripts\setup.ps1
.scripts\test.ps1
.scripts\dev.ps1
.scripts\build-extension.ps1
```

开发时也可直接运行：`python -m uvicorn app.main:app --app-dir apps/local-server --host 127.0.0.1 --port 8765`。插件默认连接该端口；发布版可用 PyInstaller 打包后由插件启动。

模型配置通过插件设置 `aiWorklog.baseUrl`、`aiWorklog.model`、`aiWorklog.enabled`，密钥使用 SecretStorage。未配置模型时使用 Mock Provider。

## 演示

执行 `docs/DEMO_SCRIPT.md`：开始任务 → 修改并保存文件 → 创建/解决 Bug → 添加备注 → 结束任务 → 审核 Mock 总结 → 确认并搜索知识库。

## 测试与限制

后端测试：`.\scripts\test.ps1`。完整人工验收见 `docs/MANUAL_TEST_CHECKLIST.md`。终端 Shell Integration、真实模型、语义检索、飞书和离线队列属于后续能力，见 `docs/KNOWN_LIMITATIONS.md`。
