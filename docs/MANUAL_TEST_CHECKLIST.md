# 人工验收清单（v0.1.1-verification / 阶段 2）

说明：每一步都记录操作、预期结果、截图位置和失败时的日志位置。截图只在人工执行时产生；本版本不把未运行 VS Code 的能力标记为自动通过。

1. **从仓库根目录启动扩展调试**
   - 操作：从仓库根目录 `AIInnovationCompetition 2` 打开 VS Code，按 F5，在调试配置中选择 `Run AI Worklog Extension`。
   - 预期结果：VS Code 自动执行 `apps/vscode-extension` 的 TypeScript compile，并打开 Extension Development Host。
   - 截图：调试配置名称、Extension Development Host 窗口和 AI Worklog Activity Bar。
   - 失败日志：VS Code `Help > Toggle Developer Tools` Console；根目录 `.vscode/tasks.json` 任务输出；`apps/vscode-extension` 编译输出。
   - 若侧边栏出现“没有可提供视图数据的已注册数据提供程序”，检查 `apps/vscode-extension/package.json` 中 `aiWorklog.sidebar` 的 `type` 是否为 `webview`，以及编译产物是否包含 `registerWebviewViewProvider`。

2. **准备打包后端**
   - 操作：运行 `scripts/build-backend.ps1`，确保仓库根目录 `artifacts/backend/ai-worklog-server.exe` 存在。
   - 预期结果：插件从 workspace 根目录解析该 EXE；仍可使用 `scripts/build-extension.ps1` 将其复制到扩展 `server/` 目录。插件实际目录为 `apps/vscode-extension`，入口为 `dist/extension.js`。
   - 截图：扩展目录和构建终端输出。
   - 失败日志：PowerShell 构建窗口；`artifacts/pyinstaller` 警告文件。

3. **后端启动与健康检查**
   - 操作：在 AI Worklog 侧边栏点击“启动后端”，必要时再执行 `AI Worklog: Start Task`。
   - 预期结果：侧边栏自动从“启动中”变为“正常”，随后任务创建成功，状态栏显示 Worklog。
   - 截图：侧边栏的状态变化和状态栏。
    - 失败日志：VS Code `View > Output > AI Worklog`；Developer Tools Console；用户数据目录 `%LOCALAPPDATA%\AIWorklogAssistant`。

4. **OutputChannel 与持久诊断日志**
   - 操作：执行命令面板中的 `AI Worklog: Show Logs`，或点击侧边栏“查看日志”；检查输出下拉框和侧边栏显示的日志文件路径。
   - 预期结果：输出下拉框存在 `AI Worklog`，包含激活日志、解析路径、端口、PID、health、状态变化和退出信息；日志文件位于 VS Code `context.logUri/ai-worklog.log`。
   - 截图：Output 下拉框、激活日志、侧边栏日志路径和最近一次错误。
   - 失败日志：若 OutputChannel 不存在，检查 `%APPDATA%\Code\logs` 下当前窗口日志及扩展宿主 Developer Tools Console。

5. **创建任务**
   - 操作：输入任务名称，使用当前 Workspace 项目名。
   - 预期结果：任务状态为 active，SQLite 生成在用户可写数据目录。
   - 截图：任务名称与开始时间。
   - 失败日志：`%LOCALAPPDATA%\AIWorklogAssistant\worklog.db`；Developer Tools Console。

6. **文件事件**
   - 操作：修改并保存一个工作区文件。
   - 预期结果：事件列表出现 `file_saved`，插件不因后端异常崩溃。
   - 截图：后端事件查询结果或侧边栏状态。
   - 失败日志：Developer Tools Console；后端 stderr（若从终端启动）。

7. **Bug 生命周期**
   - 操作：执行 `AI Worklog: Create Bug`，再执行 `AI Worklog: Resolve Bug` 并输入 Bug ID。
   - 预期结果：Bug 依次为 active、resolved。
   - 截图：Bug 创建和解决后的提示。
   - 失败日志：SQLite `bugs` 表；Developer Tools Console。

8. **备注与终端降级**
   - 操作：执行 `AI Worklog: Add Note`；执行一条终端命令后用备注补充结果。
   - 预期结果：出现 `manual_note`；Shell Integration 不可用时主流程仍可继续。
   - 截图：备注提示和事件记录。
   - 失败日志：Developer Tools Console；SQLite `events` 表。

9. **结束任务与 Mock AI**
   - 操作：执行 `AI Worklog: End Task`。
   - 预期结果：任务进入 review，生成 Mock 总结草稿。
   - 截图：总结草稿提示或审核页面。
   - 失败日志：后端 stderr；SQLite `summary_drafts` 表。

10. **审核确认与 Markdown**
   - 操作：编辑草稿后确认。
   - 预期结果：草稿为 confirmed，任务为 confirmed，并生成日报和项目任务 Markdown。
   - 截图：Markdown 文件内容和审核确认提示。
   - 失败日志：`%LOCALAPPDATA%\AIWorklogAssistant\knowledge`；后端 stderr。

11. **关键词检索**
   - 操作：执行 `AI Worklog: Search Knowledge Base`，搜索任务关键词。
   - 预期结果：返回来源文件和匹配内容。
   - 截图：搜索结果。
   - 失败日志：Developer Tools Console；知识库目录。

12. **后端异常与重启**
    - 操作：结束当前扩展启动的后端进程，观察侧边栏变为“异常”，再执行 `AI Worklog: Restart Local Server`。
    - 预期结果：异常被清楚提示；重启过程显示“启动中”，健康检查后恢复“正常”，原用户数据仍在。
    - 截图：异常状态、重启状态和恢复后的侧边栏。
    - 失败日志：VS Code `View > Output > AI Worklog`；Developer Tools Console；任务管理器；用户数据目录。

13. **VS Code 关闭清理**
    - 操作：关闭 Extension Development Host。
    - 预期结果：插件 deactivate 清理后端子进程。
    - 截图：任务管理器中进程消失（如可见）。
    - 失败日志：VS Code `View > Output > AI Worklog`；Developer Tools Console；任务管理器进程列表。

14. **安全检查**
    - 操作：检查打包目录、用户数据目录和日志；执行敏感字段测试。
    - 预期结果：密钥只通过环境/SecretStorage 注入，不进入源码、SQLite 或可执行文件日志；敏感 payload 被 `[REDACTED]` 替换。
    - 截图：脱敏事件结果和目录结构，不截取真实密钥。
    - 失败日志：后端 stderr；安全扫描命令输出。
