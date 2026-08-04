# 技术决策

- 采用 SQLite 原生 SQL，减少 3～5 天样板的迁移依赖；启动时幂等建表。
- 首版使用固定本地用户 `local-user`，保留 `user_id` 字段，不引入登录。
- 默认 Mock AI，真实供应商只预留统一配置，确保无密钥也能完成演示。
- 采用固定端口 `8765` 简化插件启动；服务只绑定回环地址并要求 Bearer Token。
- 阶段 3 结束任务采用非幂等 HTTP 409：重复结束明确提示任务已结束，避免把重复点击误认为新的结束时间。
- 阶段 3 使用 SQLite 迁移补列、`BEGIN IMMEDIATE` 和活动状态部分唯一索引保证单活动任务；项目同名同 Workspace 创建幂等。
- 首版将 VS Code 保存事件作为稳定的修改粒度；Shell Integration 和复杂 Debug 输出降级为后续能力。
阶段 4：事件单独使用 `worklog_events` 表，保留旧 `events` 接口兼容上一阶段；扩展只做有界内存缓冲，后端 SQLite 是最终数据源。

- 阶段 5：Bug 的状态转换和 active 切换由 SQLite 事务执行；UI 只反映服务端结果，不能替代唯一约束。
- 阶段 5：事件创建时快照 `bug_id`，而不是 flush 时读取当前 Bug。因此切换后的 Buffer 不会重写已排队事件的归属。
- 阶段 5：结束任务会先 flush，随后自动暂停 active Bug 并累计时长；不自动 resolve，已完成任务的 Bug 不再可修改。
# Stage 06

Workspace paths are not names: Windows path variants canonicalize into a
versioned identity hash. Git metadata remains deliberately outside the primary
identity to avoid silently merging worktrees or moved checkouts.

## Stage 07

- Provider connection checks are deliberately synthetic and stateless. Stage 07 configures providers but does not submit work data or generate summaries.
- Secrets use VS Code SecretStorage, while profiles use `globalState`; this preserves profile selection without making API keys inspectable in settings or the local database.
- DeepSeek, Qwen and custom OpenAI-compatible payloads are explicit rather than silently falling back to another provider.
- Qwen workspace domains are derived from a selected region and Workspace ID; the displayed endpoint replaces that ID with `<workspace>`.
- Extension Host E2E downloads VS Code 1.85.2 and launches it with `shell: false`. This avoids Windows path splitting caused by the test-electron launcher and retains a canary before functional suites.
## Stage 7 checkpoint decision

Stage 7 is committed as `accepted-with-known-blocker`: implementation and manual acceptance are complete, but final Stage 6 and Event/Bug Extension Host evidence is incomplete. The known blocker is extension-owned backend process survival after VS Code shutdown. This distinction prevents an unverified full-regression claim while preserving the reviewed Provider foundation as the baseline for Stage 7.1.

## Stage 7.1 decision

The Stage 7 backend-survival blocker is resolved in Stage 7.1 through explicit backend ownership, authenticated graceful shutdown, a Windows parent-handle watchdog, and verified orphan cleanup. Same-name processes are never treated as proof of ownership. Build serialization uses an atomic lock with process-start-time validation and a unique PyInstaller work directory.

## Stage 08 decision

- Context Packages are local, immutable, sanitized input snapshots, not Provider requests. Stage 9 is deliberately gated on `ready`.
- Privacy processing occurs before token budgeting and persistence; sensitive files and binary bodies are metadata-only.
- Stable sorting, deduplication, canonical JSON and SHA-256 make repeated builds comparable. Volatile package/lifecycle fields are excluded from the content hash.
- Token counts are local estimates, not provider billing tokens; no provider tokenizer or model mapping is introduced.
- The Stage 7.1 Reload Window and startup-orphan-cleanup evidence gaps remain documented rather than being hidden by an unrelated Stage 08 E2E.

## Stage 09 decision

- Ready Context is the sole model input boundary; generation cannot rebuild or bypass it.
- Provider-native structured response modes are compatibility aids, not trust boundaries: local schema/evidence/privacy validation is final.
- A draft is immutable and read-only. Editing, regeneration, approval, rejection, Markdown, and knowledge writes remain Stage 10 work.
- Retry is strictly bounded and never changes Provider, preventing accidental duplicate paid calls or routing surprises.
