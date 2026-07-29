# 开发说明

后端：`python -m pip install -r apps/local-server/requirements.txt`，再运行 `python -m uvicorn app.main:app --app-dir apps/local-server --host 127.0.0.1 --port 8765`。

插件：进入 `apps/vscode-extension` 执行 `npm.cmd install`、`npm.cmd run compile`，在 VS Code 中按 F5 启动 Extension Development Host。生产 VSIX 使用 `npx @vscode/vsce package`（需额外安装 vsce）。
