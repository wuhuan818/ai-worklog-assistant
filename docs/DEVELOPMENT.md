# 开发说明

后端：`python -m pip install -r apps/local-server/requirements.txt`，再运行 `python -m uvicorn app.main:app --app-dir apps/local-server --host 127.0.0.1 --port 8765`。发布验证执行 `scripts/build-backend.ps1`，再运行 `scripts/smoke_backend.py --executable artifacts/backend/ai-worklog-server.exe`。

插件：先打包后端，再执行 `scripts/build-extension.ps1`，它会把可执行程序复制到扩展 `server/` 目录。进入 `apps/vscode-extension` 可执行 `npm.cmd ci`、`npm.cmd run compile`、`npm.cmd run lint` 和 `npm.cmd test`，在 VS Code 中按 F5 启动 Extension Development Host。生产 VSIX 使用 `npx @vscode/vsce package`（需额外安装 vsce）。
