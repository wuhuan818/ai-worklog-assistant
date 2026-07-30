import * as vscode from 'vscode';
import * as path from 'node:path';
import { backendStateLabel } from './backendState';
import { DiagnosticLogger } from './diagnosticLogger';
import { ServerManager } from './serverManager';
import { TaskState } from './taskState';
import { TaskLifecycleController } from './taskLifecycleController';
import { EventCaptureController } from './eventCapture/eventCaptureController';
import { WorklogEvent } from './apiClient';

class Provider implements vscode.WebviewViewProvider {
  constructor(private readonly context: vscode.ExtensionContext, private readonly state: TaskState, private readonly server: ServerManager, private readonly controller: TaskLifecycleController, private readonly events: EventCaptureController) {}
  resolveWebviewView(view: vscode.WebviewView): void {
    view.webview.options = { enableScripts: true };
    const stateLabel = () => backendStateLabel(this.server.state);
    const escape = (value: string) => value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character] || character));
    const lastError = this.server.lastErrorMessage ? escape(this.server.lastErrorMessage) : '无';
    const logPath = escape(this.server.logPath || '未配置');
    view.webview.html = `<h3>AI Worklog</h3><p id="backend">后端状态：${stateLabel()}</p><p id="error">最近一次错误：${lastError}</p><p id="logPath">日志文件：${logPath}</p><p id="workspace">当前 Workspace：${escape(vscode.workspace.name || '未打开文件夹')}</p><p id="project">当前项目：同步中</p><p id="task">当前任务：${escape(this.state.label())}</p><p id="started">开始时间：-</p><p id="duration">已工作时长：-</p><p id="status">任务状态：-</p><hr><p id="eventCount">已记录事件：0</p><p id="latestEvent">最近事件：-</p><p id="latestEventTime">最近事件时间：-</p><p id="pendingEvents">待发送事件：0</p><button id="showRecentEvents" disabled>查看最近事件</button><button id="refreshEvents" disabled>刷新事件</button><hr><button id="showLogs">查看日志</button><button id="startServer">启动后端</button><button id="restartServer">重启后端</button><button id="start" disabled>开始任务</button><button id="end" disabled>结束任务</button><button id="refresh" disabled>刷新状态</button><button id="note" disabled>添加备注</button><script>const vscode=acquireVsCodeApi();const send=type=>vscode.postMessage({type});['showLogs','startServer','restartServer','start','end','refresh','note','showRecentEvents','refreshEvents'].forEach(id=>document.getElementById(id).onclick=()=>send(id));window.addEventListener('message',event=>{const d=event.data;if(d.type==='backendState'){backend.textContent='后端状态：'+d.label;if(d.error)error.textContent='最近一次错误：'+d.error;const ready=d.state==='healthy';window.backendReady=ready;['start','end','refresh','note','showRecentEvents','refreshEvents'].forEach(id=>document.getElementById(id).disabled=!ready);if(ready){end.disabled=!window.taskActive;start.disabled=window.taskActive;}}if(d.type==='taskState'){window.taskActive=!!d.active;project.textContent='当前项目：'+d.project;task.textContent='当前任务：'+d.name;started.textContent='开始时间：'+d.started;duration.textContent='已工作时长：'+d.duration;status.textContent='任务状态：'+d.status;const ready=window.backendReady===true;end.disabled=!ready||!d.active;start.disabled=!ready||d.active;}if(d.type==='eventState'){eventCount.textContent='已记录事件：'+d.total;latestEvent.textContent='最近事件：'+d.latest;latestEventTime.textContent='最近事件时间：'+d.latestTime;pendingEvents.textContent='待发送事件：'+d.pending;}});</script>`;
    const publishTaskState = () => { const task = this.state.task; const project = task ? this.controller.availableProjects.find(item => item.id === task.project_id) : undefined; void view.webview.postMessage({ type: 'taskState', name: task?.name || '暂无活动任务', project: project?.name || '-', started: task ? new Date(task.started_at).toLocaleString() : '-', duration: task?.status === 'active' ? TaskState.formatDuration(this.state.elapsedSeconds()) : TaskState.formatDuration(task?.duration_seconds || 0), status: task?.status === 'active' ? '进行中' : task?.status || '-', active: task?.status === 'active' }); };
    const publishEvents = async () => { const task = this.state.task; const api = this.server.api; if (!task || !api) { await view.webview.postMessage({ type: 'eventState', total: 0, latest: '-', latestTime: '-', pending: this.events.pendingCount }); return; } try { const [summary, recent] = await Promise.all([api.eventSummary(task.id), api.listEvents(task.id, 20)]); const latest = recent.items[recent.items.length - 1]; await view.webview.postMessage({ type: 'eventState', total: summary.total, latest: latest ? eventLabel(latest) : '-', latestTime: summary.latest_event_at ? new Date(summary.latest_event_at).toLocaleString() : '-', pending: this.events.pendingCount }); } catch { await view.webview.postMessage({ type: 'eventState', total: 0, latest: '读取失败', latestTime: '-', pending: this.events.pendingCount }); } };
    publishTaskState(); void publishEvents();
    const timer = setInterval(publishTaskState, 1000);
    const taskSubscription = this.state.onDidChange(publishTaskState);
    const taskStateSubscription = this.server.onDidChangeState(change => { if (change.state === 'healthy') { publishTaskState(); void publishEvents(); } });
    const stateSubscription = this.server.onDidChangeState(change => { void view.webview.postMessage({ type: 'backendState', state: change.state, label: backendStateLabel(change.state), error: change.error }); });
    this.context.subscriptions.push(stateSubscription);
    view.onDidDispose(() => { stateSubscription.dispose(); taskStateSubscription.dispose(); taskSubscription.dispose(); clearInterval(timer); });
    if (this.server.api) void this.controller.synchronize(this.server.api).then(publishTaskState).catch(() => undefined);
    view.webview.onDidReceiveMessage(async message => {
      try {
        if (message.type === 'start') await startTask(this.context, this.state, this.server, this.controller, this.events);
        if (message.type === 'end') await endTask(this.context, this.state, this.server, this.controller, this.events);
        if (message.type === 'refresh') await refreshTask(this.state, this.server, this.controller);
        if (message.type === 'note') await addNote(this.state, this.server);
        if (message.type === 'refreshEvents') await publishEvents();
        if (message.type === 'showRecentEvents') await showRecentEvents(this.state, this.server);
        if (message.type === 'startServer') await ensureServer(this.server);
        if (message.type === 'restartServer') await this.server.restart();
        if (message.type === 'showLogs') await vscode.commands.executeCommand('aiWorklog.showLogs');
      } catch (error) { vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error)); }
    });
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
async function createBug(state: TaskState, server: ServerManager): Promise<void> {
  if (!state.task) { vscode.window.showWarningMessage('当前没有活动任务'); return; }
  const title = await vscode.window.showInputBox({ prompt: 'Bug 标题' }); if (!title) return; const bug = await (await ensureServer(server)).createBug(state.task.id, title); vscode.window.showInformationMessage(`已创建 Bug：${String(bug.title)}`);
}
async function resolveBug(server: ServerManager): Promise<void> {
  const id = await vscode.window.showInputBox({ prompt: 'Bug ID' }); if (!id) return; await (await ensureServer(server)).resolveBug(id); vscode.window.showInformationMessage('Bug 已解决');
}
async function addNote(state: TaskState, server: ServerManager): Promise<void> {
  if (!state.task) { vscode.window.showWarningMessage('当前没有活动任务'); return; }
  const note = await vscode.window.showInputBox({ prompt: '备注', validateInput: value => value.trim().length > 4000 ? '备注最多 4000 个字符' : undefined }); if (!note?.trim()) return; await (await ensureServer(server)).batchEvents(state.task.id, [{ client_event_id: `${Date.now()}-manual`, event_type: 'manual_note', source: 'vscode', occurred_at: new Date().toISOString(), payload: { text: note.trim() } }]); vscode.window.showInformationMessage('备注已记录');
}

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
    const state = new TaskState(); const controller = new TaskLifecycleController(state, () => undefined, message => logger.appendLine(`[task] ${message}`)); const server = new ServerManager(context, logger, logPath); const events = new EventCaptureController(state, () => server.api, message => logger.appendLine(`[events] ${message}`));
    activeServer = server;
    const run = (fn: () => Promise<void>) => fn().catch(error => vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error)));
    const sync = () => server.api ? refreshTask(state, server, controller).catch(error => logger.appendLine(`[task-sync-error] ${error instanceof Error ? error.message : String(error)}`)) : Promise.resolve();
    context.subscriptions.push(server.onDidChangeState(change => { if (change.state === 'healthy') void sync(); }));
    context.subscriptions.push(vscode.commands.registerCommand('aiWorklog.startTask', () => run(() => startTask(context, state, server, controller, events))));
    context.subscriptions.push(vscode.commands.registerCommand('aiWorklog.endTask', () => run(() => endTask(context, state, server, controller, events))));
    context.subscriptions.push(vscode.commands.registerCommand('aiWorklog.createBug', () => run(() => createBug(state, server))));
    context.subscriptions.push(vscode.commands.registerCommand('aiWorklog.resolveBug', () => run(() => resolveBug(server))));
    context.subscriptions.push(vscode.commands.registerCommand('aiWorklog.addNote', () => run(() => addNote(state, server))));
    context.subscriptions.push(vscode.commands.registerCommand('aiWorklog.restartServer', () => run(async () => { await server.restart(); vscode.window.showInformationMessage('本地后端已重启'); })));
    context.subscriptions.push(vscode.commands.registerCommand('aiWorklog.showLogs', () => output.show(true)));
    context.subscriptions.push(vscode.commands.registerCommand('aiWorklog.openReview', () => vscode.window.showInformationMessage('审核页面将在结束任务后打开')));
    context.subscriptions.push(vscode.commands.registerCommand('aiWorklog.searchKnowledge', () => vscode.window.showInformationMessage('知识库搜索入口已预留')));
    context.subscriptions.push(vscode.window.registerWebviewViewProvider('aiWorklog.sidebar', new Provider(context, state, server, controller, events)));
    context.subscriptions.push(events);
    const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left); status.text = '$(pencil) Worklog'; status.command = 'aiWorklog.startTask'; status.show(); context.subscriptions.push(status);
    context.subscriptions.push({ dispose: () => { void events.flush(); void server.stop(); } });
  } catch (error) {
    logger.appendLine(`[activation-error] ${error instanceof Error ? error.message : String(error)}`);
    vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
  }
}
export async function deactivate(): Promise<void> { await activeServer?.stop(); activeServer = undefined; }
