# 人工验收清单（v0.1.1-verification / 阶段 3）

阶段 3 最小验收：F5 → 等待后端“正常” → 选择/创建项目 → 输入任务信息并开始 → 等待约 10 秒 → 点击“重启后端” → 确认任务和开始时间不变且计时继续 → 结束任务确认状态、结束时间和时长 → 重开 Extension Development Host，确认无活动任务且历史仍在 SQLite。其余阶段 2 项目按需回归。

说明：后端、SQLite、任务恢复和进程树已由自动化真实 EXE 脚本连续三轮验证；以下清单仅覆盖 VS Code Extension Development Host 的最终界面验收，不重复承担后端排错。

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
阶段 4：按 F5 后开始任务，修改/保存文件、制造并修复 Diagnostics、运行 Task、启动/停止 Debug、添加备注，刷新并查看最近事件；重启后端确认事件仍在，最后结束任务。
阶段 4 自动启动修复：关闭旧 Extension Development Host，仓库根目录按 F5；不点击“启动后端”，等待最多 10 秒，确认后端自动经历“启动中”并稳定为“正常”，且任务和事件摘要可同步。

## Automated E2E companion

The GUI checklist is complemented by the real-host command `npm.cmd run test:e2e:event-capture`; it covers the same event lifecycle plus SQLite, redaction, restart persistence, and process cleanup.

View lifecycle check: after switching away and back to AI Worklog, confirm backend remains normal, the task ID and timer remain unchanged, and task/note/refresh/event buttons remain enabled as appropriate.

## 阶段 5 最小人工验收

1. 按 F5，等待后端正常并开始工作任务。
2. 新建 Bug A 并激活，保存一个文件；新建 Bug B 并切换，再保存一个文件。
3. 确认 A 为 paused、B 为 active，两个保存事件分别归属当时的 Bug。
4. 为 B 添加 Bug 备注，填写解决摘要并解决；在列表中确认备注和解决记录。
5. reopen B，再次激活，重启后端，确认活动任务与 B 均恢复。
6. 结束任务；确认 B 自动 paused，且不能再添加备注、切换或解决。

自动化负责 SQLite、状态并发、重启、事件归属和进程清理；此清单只验证真实 Extension Host 的交互与显示。
# Bug button stability follow-up

Create and activate a Bug, observe the sidebar for ten seconds, switch away and back, then pause or resolve it and observe disabled buttons for another ten seconds.  Timer text may update; button state must remain visually stable until a business action changes it.
# Stage 06

Leave a task and active Bug open, close the Extension Development Host, then
reopen the same workspace and confirm restoration. Open another workspace with
the same data directory and confirm the conflict state and no captured event.

## ?? 7 Provider ????

1. ? AI Worklog ??? DeepSeek?Qwen ? Custom Profile??? API Key ????????????????????
2. ? Qwen ??????? Workspace ID??????????????? Endpoint ???? Workspace ID?
3. ???????????????? connected??? Profile ?????? Profile ?????????? Provider?
4. ????????? Profile?????? Key ??????????????????????? connected?
5. ????? AI Worklog??? Provider????thinking?Key ??????????????Bug??????????
6. ?? Output/??????????????????? API Key?Authorization ?????????? payload?

## Stage 07.1 backend shutdown

1. Start an Extension Development Host and confirm one owned backend becomes healthy.
2. Close that host normally; within ten seconds confirm its backend PID is gone.
3. Repeat three times and confirm no additional backend remains.
4. Reload Window; confirm the old backend exits and exactly one new healthy backend remains.
5. Keep a task open, close/reopen the host, and confirm data persists.

## Stage 08 AI Context Package

1. In an Extension Development Host, create a task, add a normal note and a synthetic `token=stage8-manual-secret-123456` note, create and resolve a Bug, create a file event and Diagnostic, then end the task.
2. Run **AI Worklog: 预览 AI 上下文**. Verify task/Bug sections, source counts, privacy and budget reports, estimated (not billed) tokens, relative paths, and a `<redacted:...>` placeholder. Do not use a real secret in this check.
3. Confirm no user absolute directory, Authorization value or raw synthetic token appears in the panel or Output log. Confirm sensitive/binary file content is absent if such a recorded event exists.
4. Select **标记为 Ready**, close and reopen the preview, and confirm the status remains Ready. Rebuild once only if a new version is desired; Ready does not call any Provider.
5. Close the host normally and confirm only its owned backend exits. Reload Window and startup orphan cleanup remain Stage 7.1 manual/evidence gaps, not claims completed by this checklist.

## Stage 09 AI Summary Generation

1. Start an Extension Development Host with F5. Create a small task with a normal note, a resolved Bug, and a small file/diagnostic or command record; then end the task.
2. Preview the context, check privacy and provenance, and mark it Ready. Do not use a real secret in notes or files.
3. Ensure one DeepSeek or Qwen profile has a key in SecretStorage. Run **AI Worklog: 生成 AI 总结草稿** and verify the confirmation shows task, context/hash summaries, schema, estimated tokens, provider/profile/model, thinking setting, output limit, and redaction/truncation counts. The warning must say the Ready Context will be sent to the selected provider.
4. Cancel once. Confirm no job or draft is created and no provider request is made. Then repeat and explicitly confirm generation.
5. When the job succeeds, open **AI Worklog: 查看 AI 总结草稿**. Confirm all eight sections are present: task summary, code changes, commands/results, Bug solutions, unresolved issues, todos, daily report, and knowledge candidates. Categories without evidence must be empty rather than invented.
6. Check displayed evidence references point to the context provenance. Confirm the panel is read-only: there are no edit, approve, reject, regenerate, Markdown-export, or knowledge-write controls.
7. Inspect the panel and AI Worklog output for the synthetic marker. Confirm no API key, Authorization header, absolute user path, provider reasoning, or raw provider response appears. Close and reopen the panel; the same persisted draft must still be available.
8. Close the Extension Development Host normally and confirm only the backend owned by this host exits.
