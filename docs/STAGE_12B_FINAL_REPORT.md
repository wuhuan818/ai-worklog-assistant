# Stage 12B Final Report — Terminal Command Capture

Date: 2026-08-13

## 1. Executive Result

**Stage 12B status: PASS**

AI Worklog Assistant 已能在用户显式活动 Task 内，通过 VS Code 1.93+ 稳定 Shell Integration API 捕获有真实结束事件的终端命令元数据，将其在本地脱敏后持久化，并作为可解析的 `terminal_command` Evidence 送入 Context Package 与结构化总结的 `commands_and_results` 输入。终端输出、环境变量及外部绝对路径不进入该链路。

产品源码、packaged 数据链、固定最低支持版本 VS Code 1.93.1 与补充版本 1.132.0 的隔离 Extension Host E2E 均已通过。两套宿主证据都覆盖真实 Shell Execution start/end、命令脱敏、输出隔离、SQLite/日志隐私、后端重启、Task 结束刷新和残留进程为零；1.93.1 官方归档还通过发布方 SHA-256 校验。

## 2. Branch / Git

| Item | Value |
|---|---|
| Branch | `stage/12b-terminal-command-capture` |
| Base | `92f730c docs: add Stage 12A final report` |
| Remote baseline | `origin/stage/12-code-change-capture` |
| Stage 12B feature commit | `6a24666 feat: capture privacy-safe terminal commands` |
| Extension Host contract-fix commit | `4d3f472 fix: validate terminal capture in extension host` |
| Remote push | Passed：`origin/stage/12b-terminal-command-capture` |
| Source working tree | Clean；未覆盖用户修改 |

## 3. Engineering Audit Findings

| Severity | Finding | Evidence | Action |
|---|---|---|---|
| High | 稳定 Terminal Shell Execution API 从 VS Code 1.93 才可用，但原 engine/E2E 为 1.85，且 `@types/vscode` 曾漂移到较新版本，存在“编译通过、旧宿主激活失败”风险。 | VS Code 1.93 release notes；原 `engines.vscode=^1.85.0` 与 E2E 1.85.2。 | engine 提升为 `^1.93.0`，类型精确锁定 `1.93.0`，Extension Host 固定 `1.93.1`。 |
| Critical | 调用 `TerminalShellExecution.read()` 会采集原始 stdout/stderr 与控制序列，隐私面远超本阶段。 | 官方 API 类型将 `read()` 定义为 execution output stream。 | 捕获模块从不调用 `.read()`；契约测试反向断言不存在调用。 |
| High | 命令可能在执行期间切换 Bug/Task，若结束时才读取当前状态会错误归属。 | Start/End 为两个异步事件；当前 Bug 可在期间改变。 | Start 时仅在内存快照 Task/Bug/start time/CWD，End 时读取更准确 command line 与 exit code。 |
| High | 宽松 JSON payload 可让 `stdout`、transcript、environment 或未来未知字段进入 SQLite。 | 原通用 payload 仅做 JSON 大小检查。 | Backend 对 `terminal_command` 使用严格字段白名单；任何输出、环境或未知字段均返回 422。 |
| Critical | 通用 redactor 漏掉 curl/mysql/docker/sshpass 常见参数及 Windows/Unix wrapper，且早期命令正则对大 diff 近似 O(n²)。 | 可复现的 wrapper secret 入库与 245 KiB 性能超时。 | 新增专用、有界、近线性命令脱敏；覆盖 cmd/PowerShell/pwsh/WSL/bash/sh、env/sudo/time/nice/command/nohup 及参数负例。 |
| High | 脱敏占位符可能膨胀，导致持久化 command 超过原 8192-byte 合同，或留下不一致 byte metadata。 | 多个短 token 被稳定 marker 替换后的 payload 可显著增长。 | 脱敏后再次 UTF-8 安全定界，重算 authoritative byte/truncation metadata，且不拆断 marker。 |
| High | 单次 flush 仅发送 100 项；并发或发送失败后结束 Task 会清 buffer，可能静默丢事件。 | 原 end/deactivate 只调用一次 best-effort flush。 | 增加可传播失败、循环排空的 `flushAll()`；失败重排，best-effort timer 不产生 unhandled rejection。 |
| High | batch 在 Task 状态检查后才开启事务，与并发 `/end` 存在 check-then-write 窗口。 | 两请求可让 completed Task 接受晚到事件。 | `BEGIN IMMEDIATE` 后才校验 Task 状态并插入，和 `/end` 使用同一 SQLite 写锁串行。 |
| Medium | Context 预算删除命令后可能保留悬空 Evidence ref；关闭 commands section 时也可能残留 ref。 | `commands_and_tasks` 与 `included_source_refs` 原先独立裁剪。 | 预算后按最终可见事件同步过滤 provenance；配置关闭时命令与 ref 同时消失。 |
| High | Task end 响应丢失会让本地状态与已 completed backend 分叉；无界 loopback 请求还会永久暂停 capture。 | `/end` 成功但响应丢失、或 backend 只返回 headers 不结束 body。 | 失败后 GET 对账；batch/end/get 使用覆盖 headers+body 的总 deadline 与 AbortController。 |
| Medium | 旧 E2E timeout 直接 `process.exit`，可能遗留 VS Code/backend；残留计数为硬编码。 | Launcher cleanup 不持有 child，未实际轮询 PID。 | 仅按本轮精确 owned PID 终止进程树，隔离 Electron/VS Code 环境变量，实际轮询初始/重启 backend PID 并写 cleanup 结果。 |
| High | Summary Review 的“文件或模块”会显示 `unknown`，即使该条 `code_changes` 已引用含真实路径的 Code Diff Evidence。 | Review adapter 只复制 provider 的 `path`，不解析 `code_diff:<id>` 对应 Context `code_diffs[].path`。 | Review 加载该 Draft 的不可变 Context，仅在 path 为空/unknown 且 Evidence 唯一解析时回填真实路径；显式 path 永不覆盖。 |
| Medium | Task 创建时收集的 description、requirement ID 与 tags 未进入 Context，因此用户付出输入成本却不改善 AI 输入。 | `tasks` 持久化字段存在，但 Context `task` 投影只包含 title/status/time。 | 将三个字段加入本地 Context task 投影，并在进入 Context 时统一脱敏；自动化验证 secret 不泄漏。 |

Official API references:

- [VS Code 1.93 — Terminal Shell Integration API](https://code.visualstudio.com/updates/v1_93/#_terminal-shell-integration-api)
- [VS Code Shell Integration documentation](https://code.visualstudio.com/docs/terminal/shell-integration)

## 4. Product Quality Audit Findings

| Area | Class | Severity | Problem | Action |
|---|---|---|---|---|
| Summary Review / 文件或模块 | Class A — Fix Now | High | 真实 Code Diff 已存在时仍展示 `unknown`，用户无法判断修改对象。 | 已修复 Evidence-to-path 解析并补 adapter 回归；旧 Draft 只要其 Context 仍含对应 Evidence 即可受益。 |
| Task Creation / 字段价值 | Class A — Fix Now | Medium | 三个可选字段被保存但未进入 Context，收集与消费断层。 | 已让 description、requirement ID、tags 进入脱敏 Context；名称仍为唯一必填字段。 |
| Task Creation / 交互 | Class C — Product Redesign | Medium | 当前为名称加三个连续 InputBox，默认创建路径过长。 | 本轮不删除仍有价值的可选信息，也不再增加一个“是否填写”步骤；建议未来用单一轻量表单集中必填/可选字段并支持后续编辑。 |
| Main UI / Sidebar | Class C — Product Redesign | Medium | 单一 Webview 将 backend、Task、events、Bug、AI provider 与操作按钮纵向堆叠，主次关系弱且需频繁滚动。 | 本轮保持行为稳定；未来按 Task/Worklog、AI/Context、Knowledge/History 分区，Settings 移出主工作流，Summary Review 继续独立。 |
| Terminal availability | Class B — Improve Now | Low | Shell Integration 不可用时若弹出错误会干扰原有工作流。 | 已采用静默能力降级；文件、Bug、Context 与 Summary 不依赖 terminal event 存在。 |

## 5. Product Changes Made

- Class A：修复 Summary Review `unknown` 路径；修复 Task 可选字段“只收集不消费”的数据断层。
- Class B：Terminal capture 使用独立开关与静默降级，不改变 Task 主流程。
- Class C：Task Creation 集中表单和 Sidebar 信息架构进入 Product Redesign Backlog。本轮没有大改 UI，因为这会同时改变输入、导航和主视图状态管理，超出局部低风险修复边界。

## 6. Stage 12B Architecture Decision

### Selected approach

使用稳定的 `window.onDidStartTerminalShellExecution` 与 `window.onDidEndTerminalShellExecution`，只捕获命令执行元数据，不读取输出流。

```text
Active Worklog Task
  -> Shell execution start: snapshot Task/Bug/start time/relative CWD in memory
  -> Shell execution end: command line/confidence/exit code/duration
  -> normalize + UTF-8 bound (Extension)
  -> POST /tasks/{task_id}/events/batch
  -> strict DTO + command-specific redaction + post-redaction rebound
  -> worklog_events.payload_json (SQLite)
  -> Context commands_and_tasks explicit field projection
  -> provenance {type:"terminal_command", id:<event-id>}
  -> AI Summary commands_and_results Evidence allow-list
```

### Boundary choices

- 仅 Start 发生在显式活动 Task 内的 execution 可以拥有事件。
- End 事件提供最终命令文本；Low confidence 与空命令被省略。
- `exitCode` 缺失时记录 `status=unknown`、`exit_code=null`。
- Task 结束时仍未收到真实 End 的命令被明确省略，不制造“interrupted”或“task-boundary”事实。
- 可选 CWD 仅保留 workspace-relative、规范化、无控制字符且不越界的路径。
- Shell Integration 不可用时安静降级，不阻断文件、Bug、Context 或 Summary 主链。

## 7. Implementation Data Flow

### Extension capture and lifecycle

- `apps/vscode-extension/src/eventCapture/terminalCommand.ts`
- `apps/vscode-extension/src/eventCapture/eventCaptureController.ts`
- `apps/vscode-extension/src/eventCapture/captureGate.ts`
- `apps/vscode-extension/src/eventBuffer.ts`
- `apps/vscode-extension/src/extension.ts`
- `apps/vscode-extension/src/apiClient.ts`

### Backend validation, persistence and privacy

- `apps/local-server/app/main.py`
- `apps/local-server/app/ai/context/redaction.py`

### Context, budget and Evidence

- `apps/local-server/app/ai/context/builder.py`
- `apps/local-server/app/ai/context/budgeting.py`
- `apps/local-server/app/ai/context/service.py`
- `apps/vscode-extension/src/ai/generation/formModel.ts`
- `apps/vscode-extension/src/ai/generation/draftPanel.ts`

### Deterministic verification

- `apps/local-server/tests/test_terminal_command_capture.py`
- `apps/vscode-extension/src/terminalCommandCapture.test.ts`
- `apps/vscode-extension/test/suite/index.js`
- `apps/vscode-extension/test/runEventCaptureE2E.js`
- `apps/vscode-extension/test/downloadVscodeTestRuntime.js`
- `scripts/verify-terminal-command-capture.py`

## 8. Privacy / Bounds

- Extension default command limit: 4096 UTF-8 bytes; configurable 256–8192; hard maximum 8192.
- Backend validates non-empty, trimmed, NFC, single-line, well-formed Unicode; C0/C1/U+2028/U+2029 are rejected or normalized before transport.
- Truncation is UTF-8 safe and adds `<command-truncated>` without splitting non-BMP characters or redaction markers.
- Persisted payload must declare `output_captured=false`.
- Explicitly excluded: stdout, stderr, terminal transcript/buffer, environment variables, terminal name, shell path, PID, absolute external CWD and unknown metadata.
- Server ignores client-authored redaction counters and derives its own `redaction_count` / `redaction_categories` before SQLite commit.
- Generic and command-specific redaction is idempotent; existing `<redacted:...>` markers are protected.
- Curl credential flags, Authorization Bearer/Basic, key/token/password assignments, sshpass/mysql/docker login and common shell/wrapper forms are covered by deterministic positive/negative tests.
- Raw terminal output is never read, even temporarily for assertions.

## 9. Database / Compatibility

No destructive migration or table replacement is required.

`terminal_command` is an additive `worklog_events.event_type`; the existing append-only `payload_json` model stores its strict sanitized representation. Existing rows and databases remain readable. Packaged verification starts the backend on one data directory, persists commands, stops it, starts a new packaged process on the same directory, and verifies that the immutable Context content is identical after restart.

Event insertion and Task completion now serialize through the same SQLite `BEGIN IMMEDIATE` write lock, preventing a completed Task from accepting a late concurrent batch.

## 10. Tests and Build Verification

| Area | Result |
|---|---|
| Python full regression | **PASS — 137 passed** |
| Backend terminal/privacy targeted regression | **PASS — 66 passed** |
| TypeScript/Node extension regression | **PASS — 85 passed, 1 skipped** (existing opt-in packaged test) |
| TypeScript compile | **PASS** |
| ESLint | **PASS** |
| E2E launcher helper tests | **PASS — 3 passed** (included in the 84) |
| Backend PyInstaller build | **PASS** |
| VSIX package | **PASS — `ai-worklog-assistant-0.1.1.vsix`, 15,324,337 bytes** |
| Packaged backend smoke | **PASS** |
| Stage 12B packaged terminal pipeline | **PASS** |
| Stage 12A packaged code-diff regression | **PASS** |
| Packaged backend restart recovery | **PASS** |
| Packaged backend lifecycle | **PASS** |
| Owned backend cleanup | **PASS — observed 0 after verification** |
| Real VS Code 1.132.0 OSC 633 Extension Host E2E | **PASS — all terminal privacy flags true; restart/end flush true; residual process count 0** |
| Real VS Code 1.93.1 OSC 633 Extension Host E2E | **PASS — all terminal privacy flags true; restart/end flush true; residual process count 0** |

Packaged Stage 12B verifier output:

```text
TERMINAL_CAPTURE_FEATURE=PASS
TERMINAL_RAW_OUTPUT_REJECTED=PASS
TERMINAL_UNKNOWN_FIELDS_REJECTED=PASS
TERMINAL_SQLITE_REDACTION=PASS
TERMINAL_POST_REDACTION_REBOUND=PASS
TERMINAL_API_REDACTION=PASS
TERMINAL_CONTEXT_ALLOWLIST=PASS
TERMINAL_CONTEXT_EVIDENCE=PASS
RESTART_RECOVERY=PASS
STAGE12B_PACKAGED_TERMINAL_COMMAND=PASS
OWNED_BACKEND_ZERO=PASS
```

Artifact integrity:

| Artifact | SHA-256 |
|---|---|
| `artifacts/backend/ai-worklog-server.exe` | `563D0B564D3DE756697003E9717D95C54C029A8B021D74FE794A75930ED7665D` |
| `apps/vscode-extension/server/ai-worklog-server.exe` | `563D0B564D3DE756697003E9717D95C54C029A8B021D74FE794A75930ED7665D` |
| `apps/vscode-extension/ai-worklog-assistant-0.1.1.vsix` | `92DA572BB3BD3D610A9F6308A8551EA640406D839DED5D522D6D42D24A287CFE` |

The Pydantic v1-validator deprecation messages are inherited warnings, not Stage 12B failures.

## 11. Demo Evidence

The packaged verifier uses inert command strings and never executes them. It persists three representative events:

1. A plain `npm.cmd test` command.
2. A curl Authorization command containing a synthetic Bearer value, which must become `<redacted:bearer-token>` before SQLite.
3. A redaction-expansion case that must be re-bounded to at most 8192 UTF-8 bytes with coherent metadata.

It also submits payloads containing inert `stdout` and `transcript` sentinels and proves they receive HTTP 422 and create zero SQLite rows. For accepted events it proves exact sanitized payload equality across SQLite, events API and Context, exact `terminal_command` Evidence refs, and immutable Context recovery after a backend restart.

The deterministic failure → fix → success integration test creates one completed Task with this ordered evidence chain:

```text
terminal_command:<failed-id>
  command = g++ hello.cpp -o hello.exe
  status = failed
  exit_code = 1

code_diff:<diff-id>
- std::cout << greet(userName) << std::endl;
+ std::cout << greet("World") << std::endl;

terminal_command:<succeeded-id>
  command = g++ hello.cpp -o hello.exe
  status = succeeded
  exit_code = 0
```

The resulting Context contains both command events and the real C++ patch in chronological order. All three refs are in the Evidence allow-list, and a deterministic structured Summary containing one `code_changes` item plus failed/succeeded `commands_and_results` passes local schema and Evidence validation. Command output is intentionally unavailable because Stage 12B never calls the raw execution output stream.

The prepared Extension Host scenario uses a Pseudoterminal to emit official OSC 633 boundaries in this order:

```text
A -> B -> E(command line) -> C -> synthetic output sentinel -> D;0
```

Its assertions require `status=succeeded`, `exit_code=0`, stable command redaction, `output_captured=false`, and absence of both the raw command secret and output sentinel from recent events, SQLite and logs. The scenario was executed successfully in an isolated VS Code 1.132.0 Extension Host. During that run it also exposed and drove the repair of a real camelCase/snake_case file-path mismatch in buffered `code_diff` events; a cross-contract regression now locks the snake_case wire format.

The successful supplemental run produced:

```json
{
  "status": "passed",
  "testVscodeVersion": "1.132.0",
  "terminalCommandCapturePassed": true,
  "terminalCommandRedactionPassed": true,
  "terminalOutputPrivacyPassed": true,
  "terminalSQLitePrivacyPassed": true,
  "terminalLogPrivacyPassed": true,
  "restartPersistence": true,
  "endTaskFlush": true,
  "residualProcessCount": 0,
  "cleanupVerified": true
}
```

The official fixed-version archive completed at 140,779,492 bytes and matched the release response header exactly:

```text
SHA-256 d74a51590e4d1c9c7ad63488c2aafb83f9b665d67f6982c8249281c21c640977
```

The first 1.93.1 host attempt hit a transient backend-auto-start timeout without a product assertion or residual process. A clean isolated rerun completed the entire suite and produced:

```json
{
  "status": "passed",
  "testVscodeVersion": "1.93.1",
  "terminalCommandCapturePassed": true,
  "terminalCommandRedactionPassed": true,
  "terminalOutputPrivacyPassed": true,
  "terminalSQLitePrivacyPassed": true,
  "terminalLogPrivacyPassed": true,
  "restartPersistence": true,
  "endTaskFlush": true,
  "residualProcessCount": 0,
  "cleanupVerified": true
}
```

## 12. Remaining Issues

### Blocking

- None.

### Non-blocking product limitations

- Capture depends on the selected shell actually enabling VS Code Shell Integration. Unsupported shells, complex prompts, subshells and some remote/SSH paths may yield no command event.
- Commands started before an active Worklog Task, Low-confidence commands, empty commands, and commands still running at Task end are deliberately omitted.
- The in-memory event buffer is not a durable offline queue; forced Extension Host termination can lose events not yet sent.
- Terminal output and environment capture are intentionally out of scope.

### Product Redesign Backlog

- Task Creation：用单一轻量表单集中任务名称与可选 description/requirement/tags，保留键盘流、取消语义和校验，并增加后续编辑入口。
- Main UI / Sidebar：将单一纵向视图按 Task/Worklog、AI/Context、Knowledge/History 分区；把 backend/provider Settings 从日常主流程移出，减少重复按钮与滚动。

### Future work

- Broader real-shell compatibility matrix beyond the deterministic PTY protocol test.
- Durable local offline event queue, if future product requirements justify the persistence/privacy trade-off.
- Richer command result summaries must continue to avoid raw terminal output unless a separate explicit privacy design is approved.

## 13. Manual UI Acceptance Needed

1. Install `apps/vscode-extension/ai-worklog-assistant-0.1.1.vsix` in VS Code 1.93 or newer.
2. Create a Task and judge the current four-step name/description/requirement/tags flow; this is the explicit input for the future concentrated-form redesign.
3. Use a shell with VS Code Shell Integration enabled, start a Worklog Task, and run a harmless command such as `git status`.
4. End the Task and confirm the recent-event view displays the command without any terminal output.
5. Build the Context Package and confirm `commands_and_tasks` contains the command and the Summary review labels its Evidence as “终端命令”.
6. Open a Summary whose `code_changes.path` was `unknown` but references one Code Diff; confirm “文件或模块” displays that Diff's actual relative path.
7. Confirm an unsupported shell degrades quietly and does not prevent Task, file event, Context or Summary workflows.
8. Review the current Sidebar vertical flow and validate the proposed future separation of Worklog, AI/Context, Knowledge/History, and Settings.
