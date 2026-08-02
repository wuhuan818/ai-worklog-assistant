# 阶段 5：Bug 生命周期与事件关联

本阶段在活动工作任务中提供多个 Bug 的创建、切换、暂停、解决与重新打开。每个 Bug 固定属于 `local-user → project → task`；已完成任务只允许查询历史，不能创建、备注或改变 Bug。

## 状态与时间

`open → active → paused → active`，以及 `open/active/paused → resolved → open`。每个任务最多一个 `active` Bug；激活另一 Bug 会在同一数据库事务中先暂停旧 Bug。后端生成 UTC 时间，并在 active 离开时累计处理秒数。结束任务会先 flush 事件、暂停当前 Bug、清空 current Bug，不会自动解决未解决项。

## Notes、解决历史与事件

Bug notes 独立于任务级 `manual_note`，用 client note ID 幂等保存，且不写入全文日志。每次 resolve 创建一条独立 resolution，reopen 保留全部旧记录。工作事件的可选 `bug_id` 在扩展入 Buffer 时固定：A 的 pending 事件即使切换到 B 后才 flush，仍归属 A；没有 current Bug 的事件保持 null。

## 恢复与验证

后端健康、重启、扩展激活、任务恢复及 View 重开都会从 SQLite 恢复 current Bug 和统计，不依赖 Webview 内存。`scripts/verify-bug-lifecycle.ps1` 对真实打包后端和临时 SQLite 验证 API、切换、事件归属、notes、resolutions、重启、结束任务与清理。Extension Host E2E 覆盖采集器与 UI；最终人工验收只需在 F5 宿主中完成两个 Bug 的切换、备注、resolve/reopen、重启恢复和结束任务。

## 安全边界

日志允许 Bug ID、状态、计数、API 状态和脱敏错误摘要；不得记录 token、secret、Bug 描述、备注、解决方案、根因、验证全文、文件内容或 Diff。
# Bug button rendering stability fix

The sidebar shell is assigned only when a Webview is resolved.  The former UI timer refreshed backend, task, Bug and event messages independently every second; those messages each wrote overlapping `disabled` attributes and produced a visible race.  The provider now emits a versioned, fingerprint-deduplicated `state` snapshot for business changes and a separate `timer` message for task/Bug durations.  Button state is calculated once from the snapshot and no timer may change it.
