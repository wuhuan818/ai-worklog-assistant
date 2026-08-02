import * as vscode from 'vscode';
import * as path from 'node:path';
import { backendStateLabel } from './backendState';
import { DiagnosticLogger } from './diagnosticLogger';
import { ServerManager } from './serverManager';
import { TaskState } from './taskState';
import { TaskLifecycleController } from './taskLifecycleController';
import { EventCaptureController } from './eventCapture/eventCaptureController';
import { BugView, WorklogEvent } from './apiClient';
import { BugState } from './bug/bugState';
import { startBackendOnActivation } from './activationStartup';
import { shouldApplyRender } from './viewState';

class Provider implements vscode.WebviewViewProvider {
  private renderVersion = 0;
  private currentView?: vscode.WebviewView;
  private viewSubscriptions: vscode.Disposable[] = [];
  private viewTimer?: ReturnType<typeof setInterval>;
  constructor(private readonly context: vscode.ExtensionContext, private readonly state: TaskState, private readonly bugs: BugState, private readonly server: ServerManager, private readonly controller: TaskLifecycleController, private readonly events: EventCaptureController, private readonly log: (message: string) => void = () => undefined) {}
  resolveWebviewView(view: vscode.WebviewView): void {
    this.viewSubscriptions.forEach(subscription => subscription.dispose());
    this.viewSubscriptions = [];
    if (this.viewTimer) clearInterval(this.viewTimer);
    this.currentView = view;
    view.webview.options = { enableScripts: true };
    this.log('[worklog-view] resolved');
    const stateLabel = () => backendStateLabel(this.server.state);
    const escape = (value: string) => value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character] || character));
    const lastError = this.server.lastErrorMessage ? escape(this.server.lastErrorMessage) : '无';
    const logPath = escape(this.server.logPath || '未配置');
    view.webview.html = `<h3>AI Worklog</h3><p id="backend">后端状态：${stateLabel()}</p><p id="error">最近一次错误：${lastError}</p><p id="logPath">日志文件：${logPath}</p><p id="workspace">当前 Workspace：${escape(vscode.workspace.name || '未打开文件夹')}</p><p id="project">当前项目：同步中</p><p id="task">当前任务：${escape(this.state.label())}</p><p id="started">开始时间：-</p><p id="duration">已工作时长：-</p><p id="status">任务状态：-</p><hr><p id="eventCount">已记录事件：0</p><p id="latestEvent">最近事件：-</p><p id="latestEventTime">最近事件时间：-</p><p id="pendingEvents">待发送事件：0</p><button id="showRecentEvents" disabled>查看最近事件</button><button id="refreshEvents" disabled>刷新事件</button><hr><p id="bug">当前 Bug：-</p><p id="bugStatus">Bug 状态：-</p><p id="bugSeverity">严重程度：-</p><p id="bugDuration">Bug 处理时长：0小时0分0秒</p><p id="bugCount">Bug 总数：0</p><p id="unresolved">未解决 Bug：0</p><button id="createBug" disabled>新建 Bug</button><button id="switchBug" disabled>切换 Bug</button><button id="pauseBug" disabled>暂停 Bug</button><button id="resolveBug" disabled>解决 Bug</button><button id="reopenBug" disabled>重新打开 Bug</button><button id="addBugNote" disabled>添加 Bug 备注</button><button id="showBugs" disabled>查看 Bug 列表</button><button id="refreshBugs" disabled>刷新 Bug</button><hr><button id="showLogs">查看日志</button><button id="startServer">启动后端</button><button id="restartServer">重启后端</button><button id="start" disabled>开始任务</button><button id="end" disabled>结束任务</button><button id="refresh" disabled>刷新状态</button><button id="note" disabled>添加备注</button><script>const vscode=acquireVsCodeApi();const send=type=>vscode.postMessage({type});['showLogs','startServer','restartServer','start','end','refresh','note','showRecentEvents','refreshEvents','createBug','switchBug','pauseBug','resolveBug','reopenBug','addBugNote','showBugs','refreshBugs'].forEach(id=>document.getElementById(id).onclick=()=>send(id));window.addEventListener('message',event=>{const d=event.data;if(d.type==='backendState'){backend.textContent='后端状态：'+d.label;if(d.error)error.textContent='最近一次错误：'+d.error;const ready=d.state==='healthy';window.backendReady=ready;['start','end','refresh','note','showRecentEvents','refreshEvents','createBug','switchBug','pauseBug','resolveBug','reopenBug','addBugNote','showBugs','refreshBugs'].forEach(id=>document.getElementById(id).disabled=!ready);if(ready){end.disabled=!window.taskActive;start.disabled=window.taskActive;}}if(d.type==='taskState'){window.taskActive=!!d.active;project.textContent='当前项目：'+d.project;task.textContent='当前任务：'+d.name;started.textContent='开始时间：'+d.started;duration.textContent='已工作时长：'+d.duration;status.textContent='任务状态：'+d.status;const ready=window.backendReady===true;end.disabled=!ready||!d.active;start.disabled=!ready||d.active;}if(d.type==='bugState'){bug.textContent='当前 Bug：'+(d.title||'-');bugStatus.textContent='Bug 状态：'+(d.status||'-');bugSeverity.textContent='严重程度：'+(d.severity||'-');bugDuration.textContent='Bug 处理时长：'+d.duration;bugCount.textContent='Bug 总数：'+d.total;unresolved.textContent='未解决 Bug：'+d.unresolved;const usable=window.backendReady===true&&window.taskActive;['createBug','switchBug','reopenBug','showBugs','refreshBugs'].forEach(id=>document.getElementById(id).disabled=!usable);pauseBug.disabled=!usable||!d.active;resolveBug.disabled=!usable||!d.active;addBugNote.disabled=!usable||!d.active;}if(d.type==='eventState'){eventCount.textContent='已记录事件：'+d.total;latestEvent.textContent='最近事件：'+d.latest;latestEventTime.textContent='最近事件时间：'+d.latestTime;pendingEvents.textContent='待发送事件：'+d.pending;}});</script>`;
    const publishBackendState = (renderVersion: number) => { if (!shouldApplyRender(renderVersion, this.renderVersion)) return; void view.webview.postMessage({ type: 'backendState', state: this.server.state, label: backendStateLabel(this.server.state), error: this.server.lastErrorMessage }); };
    const publishTaskState = (renderVersion: number) => { if (!shouldApplyRender(renderVersion, this.renderVersion)) return; const task = this.state.task; const project = task ? this.controller.availableProjects.find(item => item.id === task.project_id) : undefined; void view.webview.postMessage({ type: 'taskState', name: task?.name || '暂无活动任务', project: project?.name || '-', started: task ? new Date(task.started_at).toLocaleString() : '-', duration: task?.status === 'active' ? TaskState.formatDuration(this.state.elapsedSeconds()) : TaskState.formatDuration(task?.duration_seconds || 0), status: task?.status === 'active' ? '进行中' : task?.status || '-', active: task?.status === 'active' }); };
    const publishBugState = (renderVersion: number) => { if (!shouldApplyRender(renderVersion, this.renderVersion)) return; const current = this.bugs.current; const counts = this.bugs.counts(); void view.webview.postMessage({ type: 'bugState', title: current?.title, status: current?.status, severity: current?.severity, active: Boolean(current), duration: TaskState.formatDuration(this.bugs.elapsedSeconds()), total: Object.values(counts).reduce((a, b) => a + b, 0), unresolved: counts.open + counts.active + counts.paused }); };
    const publishEvents = async (renderVersion: number) => { const task = this.state.task; const api = this.server.api; if (!task || !api) { if (shouldApplyRender(renderVersion, this.renderVersion)) await view.webview.postMessage({ type: 'eventState', total: 0, latest: '-', latestTime: '-', pending: this.events.pendingCount }); return; } try { const [summary, recent] = await Promise.all([api.eventSummary(task.id), api.listEvents(task.id, 20)]); if (!shouldApplyRender(renderVersion, this.renderVersion)) { this.log(`[worklog-view] discarded stale render version=${renderVersion}`); return; } const latest = recent.items[recent.items.length - 1]; await view.webview.postMessage({ type: 'eventState', total: summary.total, latest: latest ? eventLabel(latest) : '-', latestTime: summary.latest_event_at ? new Date(summary.latest_event_at).toLocaleString() : '-', pending: this.events.pendingCount }); } catch { if (shouldApplyRender(renderVersion, this.renderVersion)) await view.webview.postMessage({ type: 'eventState', total: 0, latest: '读取失败', latestTime: '-', pending: this.events.pendingCount }); } };
    const refreshView = async (reason: string) => { const renderVersion = ++this.renderVersion; if (reason === 'visible') this.log('[worklog-view] visible=true'); publishBackendState(renderVersion); publishTaskState(renderVersion); publishBugState(renderVersion); await publishEvents(renderVersion); };
    void refreshView('resolve');
    this.viewTimer = setInterval(() => { if (view.visible) void refreshView('timer'); }, 1000);
    const taskSubscription = this.state.onDidChange(() => void refreshView('task')); const bugSubscription = this.bugs.onDidChange(() => void refreshView('bug'));
    const taskStateSubscription = this.server.onDidChangeState(() => void refreshView('backend'));
    const visibilitySubscription = view.onDidChangeVisibility(() => { this.log(`[worklog-view] visible=${view.visible}`); if (view.visible) void refreshView('visible'); });
    this.viewSubscriptions.push(taskStateSubscription, taskSubscription, bugSubscription, visibilitySubscription);
    view.onDidDispose(() => { if (this.currentView !== view) return; this.viewSubscriptions.forEach(subscription => subscription.dispose()); this.viewSubscriptions = []; this.currentView = undefined; if (this.viewTimer) { clearInterval(this.viewTimer); this.viewTimer = undefined; } });
    if (this.server.api) void this.controller.synchronize(this.server.api).then(() => refreshView('synchronize')).catch(() => undefined);
    this.viewSubscriptions.push(view.webview.onDidReceiveMessage(async message => {
      try {
        if (message.type === 'start') await startTask(this.context, this.state, this.server, this.controller, this.events);
        if (message.type === 'end') await endTask(this.context, this.state, this.server, this.controller, this.events);
        if (message.type === 'refresh') await refreshTask(this.state, this.server, this.controller);
        if (message.type === 'note') await addNote(this.state, this.server);
        if (message.type === 'createBug') await createBug(this.state, this.bugs, this.server);
        if (message.type === 'switchBug') await switchBug(this.state, this.bugs, this.server);
        if (message.type === 'pauseBug') await pauseBug(this.state, this.bugs, this.server);
        if (message.type === 'resolveBug') await resolveBug(this.state, this.bugs, this.server);
        if (message.type === 'reopenBug') await reopenBug(this.state, this.bugs, this.server);
        if (message.type === 'addBugNote') await addBugNote(this.state, this.bugs, this.server);
        if (message.type === 'showBugs') await showBugs(this.state, this.bugs, this.server);
        if (message.type === 'refreshBugs') await synchronizeBugs(this.state, this.bugs, this.server);
        if (message.type === 'refreshEvents') await refreshView('refresh-events');
        if (message.type === 'showRecentEvents') await showRecentEvents(this.state, this.server);
        if (message.type === 'startServer') await ensureServer(this.server);
        if (message.type === 'restartServer') await this.server.restart();
        if (message.type === 'showLogs') await vscode.commands.executeCommand('aiWorklog.showLogs');
        if (message.type !== 'refreshEvents') await refreshView(`message:${message.type}`);
      } catch (error) { vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error)); }
    }));
  }
}

function eventLabel(event: WorklogEvent): string { return event.filePath || event.eventType.replaceAll('_', ' '); }
async function showRecentEvents(state: TaskState, server: ServerManager): Promise<void> { if (!state.task || !server.api) return; const response = await server.api.listEvents(state.task.id, 20); const items = response.items.map(event => ({ label: `${new Date(event.occurredAt).toLocaleTimeString()}  ${eventLabel(event)}`, description: event.eventType, detail: summarizeEvent(event), event })); const selected = await vscode.window.showQuickPick(items, { title: '最近事件', matchOnDescription: true }); if (selected) await vscode.window.showInformationMessage(selected.detail || selected.description); }
function summarizeEvent(event: WorklogEvent): string { const payload = event.payload; if (event.eventType === 'manual_note' && typeof payload.text === 'string') return payload.text.slice(0, 4000); if (event.filePath) return event.filePath; const name = payload.name; return typeof name === 'string' ? name : event.eventType; }

async function ensureServer(server: ServerManager) { try { return await server.start(); } catch (error) { vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error)); throw error; } }
async function startTask(_context: vscode.ExtensionContext, state: TaskState, server: ServerManager, controller?: TaskLifecycleController, events?: EventCaptureController): Promise<void> {
  const name = await vscode.window.showInputBox({ prompt: '任务名称（必填）' }); if (!name?.trim()) return;
  const api = await ensureServer(server); const active=await api.activeTask(); if(active){ vscode.window.showWarningMessage(`已有活动任务：${active.name}`); state.setTask(active); return; }
  const projects=await api.listProjects(); const currentName=vscode.workspace.name||'未命名项目'; const currentPath=vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  const choices=[{label:`新建项目：${currentName}`,description:currentPath||'无 Workspace',kind:vscode.QuickPickItemKind.Default,item:undefined as typeof projects[number]|undefined},...projects.map(item=>({label:item.name,description:item.workspace_path||'无 Workspace',item}))];
  const selected=await vscode.window.showQuickPick(choices,{prompt:'选择项目或新建当前 Workspace 项目'}); if(!selected) return;
  let project=selected.item; if(!project) project=await api.createProject({name:currentName,workspace_path:currentPath});
  const description=await vscode.window.showInputBox({prompt:'任务描述（可选）'})||''; const requirement_id=await vscode.window.showInputBox({prompt:'需求编号（可选）'})||''; const rawTags=await vscode.window.showInputBox({prompt:'标签（可选，逗号分隔）'})||'';
  const task=controller ? await controller.start(api,{name:name.trim(),project_id:project.id,description,requirement_id,tags:rawTags.split(',')}) : await api.createTask({name:name.trim(),project_id:project.id,description,requirement_id,tags:rawTags.split(',')}); state.setTask(task);
  events?.record('vscode_task_started', { name: task.name, source: 'ai-worklog' });
  vscode.window.showInformationMessage(`已开始记录：${name}`);
}
async function endTask(context: vscode.ExtensionContext, state: TaskState, server: ServerManager, controller?: TaskLifecycleController, events?: EventCaptureController): Promise<void> {
  if (!state.task) { vscode.window.showWarningMessage('当前没有活动任务'); return; }
  events?.record('vscode_task_ended', { name: state.task.name });
  await events?.flush();
  const api = await ensureServer(server); const task = controller ? await controller.end(api) : await api.endTask(state.task.id); state.setTask(task);
  vscode.window.showInformationMessage(`任务已结束，工作时长：${TaskState.formatDuration(task.duration_seconds || 0)}`);
}
async function refreshTask(state: TaskState, server: ServerManager, controller: TaskLifecycleController): Promise<void> { const api=await ensureServer(server); await controller.synchronize(api); }
function toBugRecord(value: BugView): import('./bug/types').BugRecord { return { id: value.id, userId: value.user_id, projectId: value.project_id, taskId: value.task_id, title: value.title, description: value.description, severity: value.severity, category: value.category, source: value.source, externalReference: value.external_reference, tags: value.tags || [], status: value.status, createdAt: value.created_at, updatedAt: value.updated_at, activatedAt: value.activated_at, pausedAt: value.paused_at, resolvedAt: value.resolved_at, reopenedAt: value.reopened_at, totalActiveSeconds: value.total_active_seconds || 0 }; }
async function synchronizeBugs(state: TaskState, bugs: BugState, server: ServerManager): Promise<void> { if (!state.task || !server.api) { bugs.clear(); return; } const [list, current] = await Promise.all([server.api.listBugs(state.task.id), server.api.currentBug(state.task.id)]); bugs.restore(state.task.id, list.items.map(toBugRecord), current ? toBugRecord(current) : null); }
async function createBug(state: TaskState, bugs: BugState, server: ServerManager): Promise<void> {
  if (!state.task) { vscode.window.showWarningMessage('当前没有活动任务'); return; }
  const title = await vscode.window.showInputBox({ prompt: 'Bug 标题（必填）' }); if (!title?.trim()) return; const severity = await vscode.window.showQuickPick(['low', 'medium', 'high', 'critical'], { title: '严重程度' }); if (!severity) return; const description = await vscode.window.showInputBox({ prompt: 'Bug 描述（可选）' }); const rawTags = await vscode.window.showInputBox({ prompt: '标签（可选，逗号分隔）' }); const activate = await vscode.window.showQuickPick(['否', '是'], { title: '立即激活？' }); if (!activate) return; const bug = await (await ensureServer(server)).createBug(state.task.id, { title: title.trim(), severity: severity as import('./apiClient').BugSeverity, description: description?.trim(), tags: rawTags?.split(',').map(tag => tag.trim()).filter(Boolean), activate_immediately: activate === '是' }); bugs.replace(toBugRecord(bug)); vscode.window.showInformationMessage(`已创建 Bug：${bug.title}`);
}
async function switchBug(state: TaskState, bugs: BugState, server: ServerManager): Promise<void> { if (!state.task) return; const api = await ensureServer(server); const list = await api.listBugs(state.task.id); const choices = list.items.filter(b => b.status === 'open' || b.status === 'paused').map(b => ({ label: b.title, description: `${b.status} · ${b.severity}`, detail: new Date(b.updated_at).toLocaleString(), bug: b })); const selected = await vscode.window.showQuickPick(choices, { title: '切换 Bug' }); if (!selected) return; const result = await api.activateBug(state.task.id, selected.bug.id); bugs.setCurrent(toBugRecord(result)); await synchronizeBugs(state, bugs, server); }
async function pauseBug(state: TaskState, bugs: BugState, server: ServerManager): Promise<void> { const current = bugs.current; if (!state.task || !current) return; const paused = await (await ensureServer(server)).pauseBug(state.task.id, current.id); bugs.replace(toBugRecord(paused)); }
async function resolveBug(state: TaskState, bugs: BugState, server: ServerManager): Promise<void> { const current = bugs.current; if (!state.task || !current) return; const summary = await vscode.window.showInputBox({ prompt: '解决方案摘要（必填）' }); if (!summary?.trim()) return; const rootCause = await vscode.window.showInputBox({ prompt: '根本原因（可选）' }); const verification = await vscode.window.showInputBox({ prompt: '验证结果（可选）' }); const resolved = await (await ensureServer(server)).resolveBug(state.task.id, current.id, { resolution_summary: summary.trim(), root_cause: rootCause?.trim(), verification: verification?.trim() }); bugs.replace(toBugRecord(resolved)); vscode.window.showInformationMessage('Bug 已解决'); }
async function reopenBug(state: TaskState, bugs: BugState, server: ServerManager): Promise<void> { if (!state.task) return; const api = await ensureServer(server); const list = await api.listBugs(state.task.id, { status: 'resolved' }); const selected = await vscode.window.showQuickPick(list.items.map(b => ({ label: b.title, description: b.severity, bug: b })), { title: '重新打开 Bug' }); if (!selected) return; bugs.replace(toBugRecord(await api.reopenBug(state.task.id, selected.bug.id))); }
async function addBugNote(state: TaskState, bugs: BugState, server: ServerManager): Promise<void> { const current = bugs.current; if (!state.task || !current) return; const text = await vscode.window.showInputBox({ prompt: 'Bug 备注', validateInput: value => value.trim().length > 4000 ? '备注最多 4000 个字符' : undefined }); if (!text?.trim()) return; await (await ensureServer(server)).addBugNote(state.task.id, current.id, { client_note_id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, text: text.trim() }); vscode.window.showInformationMessage('Bug 备注已保存'); }
async function showBugs(state: TaskState, bugs: BugState, server: ServerManager): Promise<void> { if (!state.task) return; const list = await (await ensureServer(server)).listBugs(state.task.id); bugs.restore(state.task.id, list.items.map(toBugRecord), bugs.current || null); const selected = await vscode.window.showQuickPick(list.items.map(b => ({ label: b.title, description: `${b.status} · ${b.severity}`, detail: `${TaskState.formatDuration(b.total_active_seconds)} · ${new Date(b.updated_at).toLocaleString()}` })), { title: 'Bug 列表' }); if (selected) await vscode.window.showInformationMessage(selected.detail || selected.description); }
async function addNote(state: TaskState, server: ServerManager): Promise<void> {
  if (!state.task) { vscode.window.showWarningMessage('当前没有活动任务'); return; }
  const note = await vscode.window.showInputBox({ prompt: '备注', validateInput: value => value.trim().length > 4000 ? '备注最多 4000 个字符' : undefined }); if (!note?.trim()) return; await submitManualNote(state, server, note); vscode.window.showInformationMessage('备注已记录');
}
async function submitManualNote(state: TaskState, server: ServerManager, note: string): Promise<void> { if (!state.task || !note.trim() || note.trim().length > 4000) throw new Error('备注内容无效'); await (await ensureServer(server)).batchEvents(state.task.id, [{ client_event_id: `${Date.now()}-manual`, event_type: 'manual_note', source: 'vscode', occurred_at: new Date().toISOString(), payload: { text: note.trim() } }]); }

let activeServer: ServerManager | undefined;
export const OUTPUT_CHANNEL_NAME = 'AI Worklog';
export const ACTIVATION_LOG_LINE = '[activation] AI Worklog extension activated';

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel(OUTPUT_CHANNEL_NAME);
  context.subscriptions.push(output);
  const logPath = path.join(context.logUri.fsPath, 'ai-worklog.log');
  const logger = new DiagnosticLogger(output, logPath);
  logger.appendLine(ACTIVATION_LOG_LINE);
  logger.appendLine(`VS Code version=${vscode.version}`);
  logger.appendLine(`extensionPath=${context.extensionPath}`);
  logger.appendLine(`workspace=${vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '(none)'}`);
  try {
    const state = new TaskState(); const bugs = new BugState(); bugs.startTimer(); const controller = new TaskLifecycleController(state, () => undefined, message => logger.appendLine(`[task] ${message}`)); const server = new ServerManager(context, logger, logPath);
    activeServer = server;
    const run = (fn: () => Promise<void>) => fn().catch(error => vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error)));
    const sync = () => server.api ? refreshTask(state, server, controller).then(() => synchronizeBugs(state, bugs, server)).catch(error => logger.appendLine(`[task-sync-error] ${error instanceof Error ? error.message : String(error)}`)) : Promise.resolve();
    context.subscriptions.push(server.onDidChangeState(change => { if (change.state === 'healthy') void sync(); }));
    void startBackendOnActivation(server, logger);
    const events = new EventCaptureController(state, () => server.api, message => logger.appendLine(`[events] ${message}`), () => bugs.activeBugId);
    if (context.extensionMode === vscode.ExtensionMode.Test) {
      context.subscriptions.push(vscode.commands.registerCommand('aiWorklog.test.startTask', async () => { const api = await ensureServer(server); const name = `阶段4自动事件验收-${Date.now()}`; const project = await controller.createProject(api, vscode.workspace.name || name, vscode.workspace.workspaceFolders?.[0]?.uri.fsPath); const task = await controller.start(api, { name, project_id: project.id, description: 'Extension Host E2E event capture', requirement_id: 'STAGE-04-E2E', tags: ['stage4', 'e2e', 'event-capture'] }); state.setTask(task); return task; }));
      context.subscriptions.push(vscode.commands.registerCommand('aiWorklog.test.addManualNote', (note: string) => submitManualNote(state, server, note)));
      context.subscriptions.push(vscode.commands.registerCommand('aiWorklog.test.flushEvents', () => events.flush()));
      context.subscriptions.push(vscode.commands.registerCommand('aiWorklog.test.restartBackend', () => server.restart()));
      context.subscriptions.push(vscode.commands.registerCommand('aiWorklog.test.endTask', () => endTask(context, state, server, controller, events).then(() => bugs.clearCurrent())));
      context.subscriptions.push(vscode.commands.registerCommand('aiWorklog.test.getRuntimeState', async () => { const task = state.task; const api = server.api; let summary = { total: 0, by_type: {}, latest_event_at: null as string | null }; let recent = { items: [] as WorklogEvent[], total: 0, limit: 100, offset: 0 }; if (task && api) { try { summary = await api.eventSummary(task.id); recent = await api.listEvents(task.id, 100); } catch { /* The test harness can observe the backend error state and restart it. */ } } return { extensionMode: context.extensionMode, backendState: server.state, pid: server.pid, port: server.port, task, summary, recent, pending: events.pendingCount, logPath, dataDir: server.dataDir }; }));
    }
    context.subscriptions.push(vscode.commands.registerCommand('aiWorklog.startTask', () => run(() => startTask(context, state, server, controller, events))));
    context.subscriptions.push(vscode.commands.registerCommand('aiWorklog.endTask', () => run(() => endTask(context, state, server, controller, events).then(() => bugs.clearCurrent()))));
    context.subscriptions.push(vscode.commands.registerCommand('aiWorklog.createBug', () => run(() => createBug(state, bugs, server))));
    context.subscriptions.push(vscode.commands.registerCommand('aiWorklog.resolveBug', () => run(() => resolveBug(state, bugs, server))));
    context.subscriptions.push(vscode.commands.registerCommand('aiWorklog.addNote', () => run(() => addNote(state, server))));
    context.subscriptions.push(vscode.commands.registerCommand('aiWorklog.restartServer', () => run(async () => { await server.restart(); vscode.window.showInformationMessage('本地后端已重启'); })));
    context.subscriptions.push(vscode.commands.registerCommand('aiWorklog.showLogs', () => output.show(true)));
    context.subscriptions.push(vscode.commands.registerCommand('aiWorklog.openReview', () => vscode.window.showInformationMessage('审核页面将在结束任务后打开')));
    context.subscriptions.push(vscode.commands.registerCommand('aiWorklog.searchKnowledge', () => vscode.window.showInformationMessage('知识库搜索入口已预留')));
    context.subscriptions.push(vscode.window.registerWebviewViewProvider('aiWorklog.sidebar', new Provider(context, state, bugs, server, controller, events, message => logger.appendLine(message))));
    context.subscriptions.push(events);
    const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left); status.text = '$(pencil) Worklog'; status.command = 'aiWorklog.startTask'; status.show(); context.subscriptions.push(status);
    context.subscriptions.push({ dispose: () => { bugs.dispose(); void events.flush(); void server.stop(); } });
  } catch (error) {
    logger.appendLine(`[activation-error] ${error instanceof Error ? error.message : String(error)}`);
    vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
  }
}
export async function deactivate(): Promise<void> { await activeServer?.stop(); activeServer = undefined; }
