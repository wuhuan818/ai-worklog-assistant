import * as vscode from 'vscode';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { backendStateLabel } from './backendState';
import { DiagnosticLogger } from './diagnosticLogger';
import { ServerManager } from './serverManager';
import { TaskState } from './taskState';
import { TaskLifecycleController } from './taskLifecycleController';
import { EventCaptureController } from './eventCapture/eventCaptureController';
import { RecoveryController } from './recoveryController';
import { resolveWorkspaceIdentity } from './workspaceIdentity';
import { promptPick, promptText } from './wizardInput';
import { BugView, WorklogEvent } from './apiClient';
import { BugState } from './bug/bugState';
import { startBackendOnActivation } from './activationStartup';
import { shouldApplyRender } from './viewState';
import { buttonState, SnapshotDeduper, WorklogViewSnapshot } from './viewSnapshot';
import { AiProfileStore, AiProviderKind, AiProviderProfile, defaultsFor, qwenRegionOptions, qwenWorkspaceBaseUrl } from './ai/profileStore';
import { aiViewModel } from './ai/viewModel';
import { AiConnectionStateStore } from './ai/connectionState';
import { registerContextCommands } from './ai/context/commands';
import { registerGenerationCommands } from './ai/generation/commands';
import { GenerationJob, generationStatusLabel } from './ai/generation/types';
import { generationFingerprint } from './ai/generation/viewModel';

class Provider implements vscode.WebviewViewProvider {
  private renderVersion = 0;
  private currentView?: vscode.WebviewView;
  private viewSubscriptions: vscode.Disposable[] = [];
  private viewTimer?: ReturnType<typeof setInterval>;
  private readonly snapshotDeduper = new SnapshotDeduper();
  private aiSnapshot?: ReturnType<typeof aiViewModel>;
  private aiPublishCount = 0;
  private resolveCount = 0;
  private visibilityChangeCount = 0;
  private generationFingerprint = '';
  private generationStatusLabel = 'AI Summary: not generated';
  private generationStatus = 'not_generated';
  private generationError = '';
  constructor(private readonly context: vscode.ExtensionContext, private readonly state: TaskState, private readonly bugs: BugState, private readonly server: ServerManager, private readonly controller: TaskLifecycleController, private readonly events: EventCaptureController, private readonly aiProfiles: AiProfileStore, private readonly aiConnection: AiConnectionStateStore, private readonly log: (message: string) => void = () => undefined) {}
  testAiViewState(): { snapshot?: ReturnType<typeof aiViewModel>; resolveCount: number; visibilityChangeCount: number; aiPublishCount: number; listenerCount: number; visible: boolean } {
    return { snapshot: this.aiSnapshot, resolveCount: this.resolveCount, visibilityChangeCount: this.visibilityChangeCount, aiPublishCount: this.aiPublishCount, listenerCount: this.viewSubscriptions.length, visible: Boolean(this.currentView?.visible) };
  }
  testRecordAiViewState(profile: AiProviderProfile | undefined, hasKey: boolean): ReturnType<typeof aiViewModel> {
    const connection = this.aiConnection.forProfile(profile); this.aiSnapshot = aiViewModel(profile, hasKey, connection.connection, connection.lastTest); this.aiPublishCount++;
    if (this.currentView) void this.currentView.webview.postMessage({ type: 'aiState', ...this.aiSnapshot });
    return this.aiSnapshot;
  }
  testRefreshAiViewState(): ReturnType<typeof aiViewModel> { if (!this.aiSnapshot) throw new Error('AI ViewModel has not been published'); this.aiPublishCount++; if (this.currentView) void this.currentView.webview.postMessage({ type: 'aiState', ...this.aiSnapshot }); return this.aiSnapshot; }
  publishGenerationState(job: GenerationJob | undefined): void { const fingerprint = generationFingerprint(job); if (fingerprint === this.generationFingerprint) return; this.generationFingerprint = fingerprint; this.generationStatus = job?.status || 'not_generated'; this.generationError = job?.error_summary ? `${job.error_code || 'generation_failed'} · attempts ${job.attempt_count || 0}: ${job.error_summary}`.slice(0, 700) : ''; this.generationStatusLabel = job ? `AI Summary: ${generationStatusLabel(job.status)}` : 'AI Summary: not generated'; if (this.currentView) void this.currentView.webview.postMessage({ type: 'generationState', label: this.generationStatusLabel, status: this.generationStatus, error: this.generationError }); }
  resolveWebviewView(view: vscode.WebviewView): void {
    this.resolveCount++;
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
    // The shell is assigned only once per resolved Webview.  State and timer
    // updates below mutate existing DOM nodes instead of replacing this HTML.
    view.webview.html += `<script>let stateVersion=0,lastButtons='';window.addEventListener('message',e=>{const m=e.data;if(m.type==='timer'){duration.textContent=m.taskDuration;bugDuration.textContent=m.bugDuration;return}if(m.type!=='state'||m.version<stateVersion)return;stateVersion=m.version;const s=m.snapshot;backend.textContent='后端状态：'+s.backendLabel;error.textContent='最近一次错误：'+s.error;project.textContent='当前项目：'+s.task.project;task.textContent='当前任务：'+s.task.name;started.textContent='开始时间：'+s.task.started;status.textContent='任务状态：'+s.task.status;bug.textContent='当前 Bug：'+s.bug.title;bugStatus.textContent='Bug 状态：'+s.bug.status;bugSeverity.textContent='严重程度：'+s.bug.severity;bugCount.textContent='Bug 总数：'+s.bug.total;unresolved.textContent='未解决 Bug：'+s.bug.unresolved;eventCount.textContent='已记录事件：'+s.events.total;latestEvent.textContent='最近事件：'+s.events.latest;latestEventTime.textContent='最近事件时间：'+s.events.latestTime;pendingEvents.textContent='待发送事件：'+s.events.pending;const key=JSON.stringify(s.buttons);if(key!==lastButtons){lastButtons=key;Object.entries(s.buttons).forEach(([id,enabled])=>{const el=document.getElementById(id);if(el&&el.disabled===enabled)el.disabled=!enabled})}})</script>`;
    view.webview.html += `<script>const ai=document.createElement('section');ai.innerHTML='<hr><p id="aiProvider">AI Provider：未配置</p><p id="aiProfile">AI Profile：-</p><p id="aiModel">模型：-</p><p id="aiThinking">思考模式：关闭</p><p id="aiKey">API Key：未配置</p><p id="aiConnection">连接状态：未测试</p><p id="aiLastTest">最近测试：-</p><p id="aiWorkspace">Workspace ID：-</p><p id="aiEndpoint">Endpoint：-</p><button id="configureAi">配置 AI</button><button id="switchAi">切换 AI</button><button id="testAi">测试连接</button><button id="clearAiKey">清除 API Key</button><button id="deleteAi">删除 AI 配置</button>';document.body.appendChild(ai);['configureAi','switchAi','testAi','clearAiKey','deleteAi'].forEach(id=>document.getElementById(id).onclick=()=>vscode.postMessage({type:id}));window.addEventListener('message',e=>{const m=e.data;if(m.type==='aiState'){aiProvider.textContent='AI Provider：'+m.provider;aiProfile.textContent='AI Profile：'+m.profile;aiModel.textContent='模型：'+m.model;aiThinking.textContent='思考模式：'+m.thinking;aiKey.textContent='API Key：'+m.apiKey;aiConnection.textContent='连接状态：'+m.connection;aiLastTest.textContent='最近测试：'+m.lastTest;aiWorkspace.textContent='Workspace ID：'+m.workspace;aiEndpoint.textContent='Endpoint：'+m.endpoint;}});</script>`;
    view.webview.html += `<script>const context=document.createElement('section');const contextSummary=document.createElement('p');contextSummary.textContent='AI Context：仅可预览已结束任务';const contextPreview=document.createElement('button');contextPreview.textContent='预览上下文';contextPreview.addEventListener('click',()=>vscode.postMessage({type:'previewAiContext'}));const generation=document.createElement('p');generation.id='generationState';generation.textContent='AI Summary: not generated';const generationActions=document.createElement('span');generationActions.id='generationActions';function generationButton(label,type){const b=document.createElement('button');b.textContent=label;b.onclick=()=>vscode.postMessage({type});return b}function renderGenerationActions(status){generationActions.replaceChildren();if(['queued','running','validating'].includes(status))generationActions.append(generationButton('取消生成','cancelAiSummaryGeneration'));else if(status==='succeeded'){generationActions.append(generationButton('查看草稿','viewAiSummaryDrafts'),generationButton('生成新草稿','generateAiSummaryDraft'));}else if(['failed','cancelled','interrupted'].includes(status)){generationActions.append(generationButton('重新生成','generateAiSummaryDraft'),generationButton('查看错误','showGenerationError'));}else generationActions.append(generationButton('生成总结草稿','generateAiSummaryDraft'));}renderGenerationActions('not_generated');const history=generationButton('历史任务与总结','viewAiSummaryDrafts');context.append(document.createElement('hr'),contextSummary,contextPreview,generation,generationActions,history);document.body.appendChild(context);window.addEventListener('message',e=>{if(e.data.type==='generationState'){generation.textContent=e.data.label;window.generationError=e.data.error||'';renderGenerationActions(e.data.status||'not_generated');}});</script>`;
    void view.webview.postMessage({ type: 'generationState', label: this.generationStatusLabel, status: this.generationStatus, error: this.generationError });
    const publishBackendState = (renderVersion: number) => { if (!shouldApplyRender(renderVersion, this.renderVersion)) return; void view.webview.postMessage({ type: 'backendState', state: this.server.state, label: backendStateLabel(this.server.state), error: this.server.lastErrorMessage }); };
    const publishTaskState = (renderVersion: number) => { if (!shouldApplyRender(renderVersion, this.renderVersion)) return; const task = this.state.task; const project = task ? this.controller.availableProjects.find(item => item.id === task.project_id) : undefined; void view.webview.postMessage({ type: 'taskState', name: task?.name || '暂无活动任务', project: project?.name || '-', started: task ? new Date(task.started_at).toLocaleString() : '-', duration: task?.status === 'active' ? TaskState.formatDuration(this.state.elapsedSeconds()) : TaskState.formatDuration(task?.duration_seconds || 0), status: task?.status === 'active' ? '进行中' : task?.status || '-', active: task?.status === 'active' }); };
    const publishBugState = (renderVersion: number) => { if (!shouldApplyRender(renderVersion, this.renderVersion)) return; const current = this.bugs.current; const counts = this.bugs.counts(); void view.webview.postMessage({ type: 'bugState', title: current?.title, status: current?.status, severity: current?.severity, active: Boolean(current), duration: TaskState.formatDuration(this.bugs.elapsedSeconds()), total: Object.values(counts).reduce((a, b) => a + b, 0), unresolved: counts.open + counts.active + counts.paused }); };
    const publishEvents = async (renderVersion: number) => { const task = this.state.task; const api = this.server.api; if (!task || !api) { if (shouldApplyRender(renderVersion, this.renderVersion)) await view.webview.postMessage({ type: 'eventState', total: 0, latest: '-', latestTime: '-', pending: this.events.pendingCount }); return; } try { const [summary, recent] = await Promise.all([api.eventSummary(task.id), api.listEvents(task.id, 20)]); if (!shouldApplyRender(renderVersion, this.renderVersion)) { this.log(`[worklog-view] discarded stale render version=${renderVersion}`); return; } const latest = recent.items[recent.items.length - 1]; await view.webview.postMessage({ type: 'eventState', total: summary.total, latest: latest ? eventLabel(latest) : '-', latestTime: summary.latest_event_at ? new Date(summary.latest_event_at).toLocaleString() : '-', pending: this.events.pendingCount }); } catch { if (shouldApplyRender(renderVersion, this.renderVersion)) await view.webview.postMessage({ type: 'eventState', total: 0, latest: '读取失败', latestTime: '-', pending: this.events.pendingCount }); } };
    // Retained only as compatibility helpers while existing compiled-test
    // contracts inspect their message names; normal rendering uses state/timer.
    void [publishBackendState, publishTaskState, publishBugState, publishEvents];
    const refreshView = async (reason: string) => {
      const renderVersion = ++this.renderVersion; if (reason === 'visible') this.log('[worklog-view] visible=true');
      const task = this.state.task; const current = this.bugs.current; const counts = this.bugs.counts(); let eventTotal = 0; let latest = '-'; let latestTime = '-';
      if (task && this.server.api) try { const [summary, recent] = await Promise.all([this.server.api.eventSummary(task.id), this.server.api.listEvents(task.id, 20)]); if (!shouldApplyRender(renderVersion, this.renderVersion)) return; eventTotal = summary.total; const last = recent.items[recent.items.length - 1]; latest = last ? eventLabel(last) : '-'; latestTime = summary.latest_event_at ? new Date(summary.latest_event_at).toLocaleString() : '-'; } catch { latest = '读取失败'; }
      if (!shouldApplyRender(renderVersion, this.renderVersion)) return;
      const project = task ? this.controller.availableProjects.find(item => item.id === task.project_id) : undefined; const snapshot: WorklogViewSnapshot = { backendState: this.server.state, backendLabel: backendStateLabel(this.server.state), error: this.server.lastErrorMessage || '无', task: { name: task?.name || '暂无活动任务', project: project?.name || '-', started: task ? new Date(task.started_at).toLocaleString() : '-', status: task?.status === 'active' ? '进行中' : task?.status || '-', active: task?.status === 'active' }, bug: { title: current?.title || '-', status: current?.status || '-', severity: current?.severity || '-', active: Boolean(current && current.status === 'active'), total: Object.values(counts).reduce((a, b) => a + b, 0), unresolved: counts.open + counts.active + counts.paused }, events: { total: eventTotal, latest, latestTime, pending: this.events.pendingCount }, buttons: buttonState(this.server.state, task?.status === 'active', Boolean(current && current.status === 'active')) };
      if (this.snapshotDeduper.shouldSend(snapshot)) void view.webview.postMessage({ type: 'state', version: renderVersion, snapshot });
    };
    void refreshView('resolve');
    const publishAi = async () => { const profile = this.aiProfiles.current(); const key = profile ? await this.aiProfiles.key(profile.id) : undefined; const connection = this.aiConnection.forProfile(profile); this.aiSnapshot = aiViewModel(profile, Boolean(key), connection.connection, connection.lastTest); this.aiPublishCount++; await view.webview.postMessage({ type: 'aiState', ...this.aiSnapshot }); };
    void publishAi();
    this.viewTimer = setInterval(() => { if (view.visible) void view.webview.postMessage({ type: 'timer', taskDuration: TaskState.formatDuration(this.state.task?.status === 'active' ? this.state.elapsedSeconds() : this.state.task?.duration_seconds || 0), bugDuration: TaskState.formatDuration(this.bugs.elapsedSeconds()) }); }, 1000);
    const taskSubscription = this.state.onDidChange(() => void refreshView('task')); const bugSubscription = this.bugs.onDidChange(() => void refreshView('bug'));
    const taskStateSubscription = this.server.onDidChangeState(() => void refreshView('backend'));
    const visibilitySubscription = view.onDidChangeVisibility(() => { this.visibilityChangeCount++; this.log(`[worklog-view] visible=${view.visible}`); if (view.visible) { void refreshView('visible'); void publishAi(); } });
    this.viewSubscriptions.push(taskStateSubscription, taskSubscription, bugSubscription, visibilitySubscription, this.aiConnection.onDidChange(() => void publishAi()));
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
        if (message.type === 'previewAiContext') await vscode.commands.executeCommand('aiWorklog.previewAiContext');
        if (message.type === 'generateAiSummaryDraft') await vscode.commands.executeCommand('aiWorklog.generateAiSummaryDraft');
        if (message.type === 'viewAiSummaryDrafts') await vscode.commands.executeCommand('aiWorklog.viewAiSummaryDrafts');
        if (message.type === 'cancelAiSummaryGeneration') await vscode.commands.executeCommand('aiWorklog.cancelAiSummaryGeneration');
        if (message.type === 'showGenerationError') vscode.window.showErrorMessage(this.generationError || '没有可显示的生成错误。');
        if (message.type === 'configureAi') await vscode.commands.executeCommand('aiWorklog.configureAiProvider');
        if (message.type === 'switchAi') await vscode.commands.executeCommand('aiWorklog.switchAiProvider');
        if (message.type === 'testAi') await vscode.commands.executeCommand('aiWorklog.testAiConnection');
        if (message.type === 'clearAiKey') await vscode.commands.executeCommand('aiWorklog.clearAiApiKey');
        if (message.type === 'deleteAi') await vscode.commands.executeCommand('aiWorklog.deleteAiProvider');
        if (['configureAi','switchAi','clearAiKey','deleteAi'].includes(message.type)) await publishAi();
        if (message.type !== 'refreshEvents') await refreshView(`message:${message.type}`);
      } catch (error) { vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error)); }
    }));
  }
}

function eventLabel(event: WorklogEvent): string { return event.filePath || event.eventType.replaceAll('_', ' '); }
async function showRecentEvents(state: TaskState, server: ServerManager): Promise<void> { if (!state.task || !server.api) return; const response = await server.api.listEvents(state.task.id, 20); const items = response.items.map(event => ({ label: `${new Date(event.occurredAt).toLocaleTimeString()}  ${eventLabel(event)}`, description: event.eventType, detail: summarizeEvent(event), event })); const selected = await vscode.window.showQuickPick(items, { title: '最近事件', matchOnDescription: true, ignoreFocusOut: true }); if (selected) await vscode.window.showInformationMessage(selected.detail || selected.description); }
function summarizeEvent(event: WorklogEvent): string { const payload = event.payload; if (event.eventType === 'manual_note' && typeof payload.text === 'string') return payload.text.slice(0, 4000); if (event.filePath) return event.filePath; const name = payload.name; return typeof name === 'string' ? name : event.eventType; }

async function ensureServer(server: ServerManager) { try { return await server.start(); } catch (error) { vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error)); throw error; } }
async function startTask(_context: vscode.ExtensionContext, state: TaskState, server: ServerManager, controller?: TaskLifecycleController, events?: EventCaptureController): Promise<void> {
  const nameResult = await promptText({ prompt: '任务名称（必填）' }); if (nameResult.kind === 'cancelled' || !nameResult.value.trim()) return; const name = nameResult.value;
  const api = await ensureServer(server); const active=await api.activeTask(); if(active){ vscode.window.showWarningMessage(`已有活动任务：${active.name}`); state.setTask(active); return; }
  const identity = resolveWorkspaceIdentity(); const currentPath=vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!identity) { vscode.window.showWarningMessage('请先打开工作区，再创建任务'); return; }
  const project=(await api.resolveProject({name: identity.displayName, workspace_path: currentPath, workspace_identity_key: identity.canonicalKey, workspace_identity_version: identity.version, workspace_kind: identity.kind, canonical_workspace_uri: identity.canonicalUris[0]})).project;
  const descriptionResult=await promptText({prompt:'任务描述（可选）'}); if(descriptionResult.kind==='cancelled')return; const requirementResult=await promptText({prompt:'需求编号（可选）'}); if(requirementResult.kind==='cancelled')return; const tagsResult=await promptText({prompt:'标签（可选，逗号分隔）'}); if(tagsResult.kind==='cancelled')return; const description=descriptionResult.value; const requirement_id=requirementResult.value; const rawTags=tagsResult.value;
  const task=controller ? await controller.start(api,{name:name.trim(),project_id:project.id,description,requirement_id,tags:rawTags.split(',')}) : await api.createTask({name:name.trim(),project_id:project.id,description,requirement_id,tags:rawTags.split(',')}); state.setTask(task); events?.setEnabled(true);
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
  const titleResult=await promptText({prompt:'Bug 标题（必填）'}); if(titleResult.kind==='cancelled'||!titleResult.value.trim())return; const severityResult=await promptPick(['low','medium','high','critical'].map(label=>({label})),{title:'严重程度'}); if(severityResult.kind==='cancelled')return; const descriptionResult=await promptText({prompt:'Bug 描述（可选）'}); if(descriptionResult.kind==='cancelled')return; const tagsResult=await promptText({prompt:'标签（可选，逗号分隔）'}); if(tagsResult.kind==='cancelled')return; const activateResult=await promptPick(['否','是'].map(label=>({label})),{title:'立即激活？'}); if(activateResult.kind==='cancelled')return; const bug=await(await ensureServer(server)).createBug(state.task.id,{title:titleResult.value.trim(),severity:severityResult.value.label as import('./apiClient').BugSeverity,description:descriptionResult.value.trim(),tags:tagsResult.value.split(',').map(tag=>tag.trim()).filter(Boolean),activate_immediately:activateResult.value.label==='是'}); bugs.replace(toBugRecord(bug)); vscode.window.showInformationMessage(`已创建 Bug：${bug.title}`);
}
async function switchBug(state: TaskState, bugs: BugState, server: ServerManager): Promise<void> { if (!state.task) return; const api = await ensureServer(server); const list = await api.listBugs(state.task.id); const choices = list.items.filter(b => b.status === 'open' || b.status === 'paused').map(b => ({ label: b.title, description: `${b.status} · ${b.severity}`, detail: new Date(b.updated_at).toLocaleString(), bug: b })); const selected = await vscode.window.showQuickPick(choices, { title: '切换 Bug', ignoreFocusOut: true }); if (!selected) return; const result = await api.activateBug(state.task.id, selected.bug.id); bugs.setCurrent(toBugRecord(result)); await synchronizeBugs(state, bugs, server); }
async function pauseBug(state: TaskState, bugs: BugState, server: ServerManager): Promise<void> { const current = bugs.current; if (!state.task || !current) return; const paused = await (await ensureServer(server)).pauseBug(state.task.id, current.id); bugs.replace(toBugRecord(paused)); }
async function resolveBug(state: TaskState, bugs: BugState, server: ServerManager): Promise<void> { const current = bugs.current; if (!state.task || !current) return; const summary=await promptText({prompt:'解决方案摘要（必填）'}); if(summary.kind==='cancelled'||!summary.value.trim())return; const rootCause=await promptText({prompt:'根本原因（可选）'}); if(rootCause.kind==='cancelled')return; const verification=await promptText({prompt:'验证结果（可选）'}); if(verification.kind==='cancelled')return; const resolved=await(await ensureServer(server)).resolveBug(state.task.id,current.id,{resolution_summary:summary.value.trim(),root_cause:rootCause.value.trim(),verification:verification.value.trim()}); bugs.replace(toBugRecord(resolved)); vscode.window.showInformationMessage('Bug 已解决'); }
async function reopenBug(state: TaskState, bugs: BugState, server: ServerManager): Promise<void> { if (!state.task) return; const api = await ensureServer(server); const list = await api.listBugs(state.task.id, { status: 'resolved' }); const selected = await vscode.window.showQuickPick(list.items.map(b => ({ label: b.title, description: b.severity, bug: b })), { title: '重新打开 Bug', ignoreFocusOut: true }); if (!selected) return; bugs.replace(toBugRecord(await api.reopenBug(state.task.id, selected.bug.id))); }
async function addBugNote(state: TaskState, bugs: BugState, server: ServerManager): Promise<void> { const current = bugs.current; if (!state.task || !current) return; const result=await promptText({prompt:'Bug 备注',validateInput:value=>value.trim().length>4000?'备注最多 4000 个字符':undefined}); if(result.kind==='cancelled'||!result.value.trim())return; await(await ensureServer(server)).addBugNote(state.task.id,current.id,{client_note_id:`${Date.now()}-${Math.random().toString(36).slice(2)}`,text:result.value.trim()}); vscode.window.showInformationMessage('Bug 备注已保存'); }
async function showBugs(state: TaskState, bugs: BugState, server: ServerManager): Promise<void> { if (!state.task) return; const list = await (await ensureServer(server)).listBugs(state.task.id); bugs.restore(state.task.id, list.items.map(toBugRecord), bugs.current || null); const selected = await vscode.window.showQuickPick(list.items.map(b => ({ label: b.title, description: `${b.status} · ${b.severity}`, detail: `${TaskState.formatDuration(b.total_active_seconds)} · ${new Date(b.updated_at).toLocaleString()}` })), { title: 'Bug 列表', ignoreFocusOut: true }); if (selected) await vscode.window.showInformationMessage(selected.detail || selected.description); }
async function addNote(state: TaskState, server: ServerManager): Promise<void> {
  if (!state.task) { vscode.window.showWarningMessage('当前没有活动任务'); return; }
  const result=await promptText({prompt:'备注',validateInput:value=>value.trim().length>4000?'备注最多 4000 个字符':undefined}); if(result.kind==='cancelled'||!result.value.trim())return; await submitManualNote(state,server,result.value); vscode.window.showInformationMessage('备注已记录');
}
async function submitManualNote(state: TaskState, server: ServerManager, note: string): Promise<void> { if (!state.task || !note.trim() || note.trim().length > 4000) throw new Error('备注内容无效'); await (await ensureServer(server)).batchEvents(state.task.id, [{ client_event_id: `${Date.now()}-manual`, event_type: 'manual_note', source: 'vscode', occurred_at: new Date().toISOString(), payload: { text: note.trim() } }]); }

let activeServer: ServerManager | undefined;
let activeEvents: EventCaptureController | undefined;
async function configureAi(store: AiProfileStore): Promise<void> {
  const display = await promptText({ prompt: 'AI Profile 名称' }); if (display.kind === 'cancelled' || !display.value.trim()) return;
  const providerPick = await promptPick([{ label: 'DeepSeek', provider: 'deepseek' as AiProviderKind }, { label: 'Qwen', provider: 'qwen' as AiProviderKind }, { label: 'Custom OpenAI-compatible', provider: 'openai-compatible' as AiProviderKind }], { title: 'AI Provider' }); if (providerPick.kind === 'cancelled') return;
  const defaults = defaultsFor(providerPick.value.provider);
  let qwenBaseUrl = defaults.baseUrl; let qwenRegion: import('./ai/profileStore').QwenRegion | undefined; let workspaceId: string | undefined;
  if (providerPick.value.provider === 'qwen') { const region = await promptPick(qwenRegionOptions, { title: 'Qwen 地域' }); if (region.kind === 'cancelled') return; qwenRegion = region.value.region; if (region.value.region === 'custom') { const custom = await promptText({ prompt: 'Qwen 自定义 Base URL' }); if (custom.kind === 'cancelled' || !custom.value.trim()) return; qwenBaseUrl = custom.value; } else if (region.value.requiresWorkspaceId) { const workspace = await promptText({ prompt: 'Qwen Workspace ID' }); if (workspace.kind === 'cancelled' || !workspace.value.trim()) return; workspaceId = workspace.value.trim(); try { qwenBaseUrl = qwenWorkspaceBaseUrl(region.value.region, workspaceId); } catch (error) { vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error)); return; } } else qwenBaseUrl = region.value.baseUrl; }
  const base = providerPick.value.provider === 'qwen' ? { kind: 'accepted' as const, value: qwenBaseUrl } : await promptText({ prompt: 'Base URL', value: defaults.baseUrl }); if (base.kind === 'cancelled' || !base.value.trim()) return;
  const model = await promptText({ prompt: '模型', value: defaults.model }); if (model.kind === 'cancelled' || !model.value.trim()) return;
  if (providerPick.value.provider === 'deepseek' && ['deepseek-chat', 'deepseek-reasoner'].includes(model.value.trim())) { vscode.window.showWarningMessage('该 DeepSeek 旧模型名不应作为默认值，请确认可用性。'); }
  const key = await promptText({ prompt: 'API Key', password: true }); if (key.kind === 'cancelled' || !key.value) return;
  const timestamp = new Date().toISOString(); const profile: AiProviderProfile = { id: randomUUID(), displayName: display.value.trim(), provider: providerPick.value.provider, baseUrl: base.value.trim().replace(/\/+$/, ''), model: model.value.trim(), thinkingEnabled: false, timeoutSeconds: 30, maxOutputTokens: 2048, createdAt: timestamp, updatedAt: timestamp, qwenRegion, workspaceId };
  await store.save(profile, key.value); await store.select(profile.id); vscode.window.showInformationMessage('AI Provider 已安全保存。');
}
async function testAiRequest(store: AiProfileStore, server: ServerManager, connection: AiConnectionStateStore) { const profile = store.current(); if (!profile) throw new Error('请先配置 AI Provider'); const key = await store.key(profile.id); if (!key) throw new Error('API Key 未配置'); connection.testing(profile); try { const result = await (await ensureServer(server)).testAiConnection({ provider: profile.provider, base_url: profile.baseUrl, model: profile.model, api_key: key, thinking_enabled: profile.thinkingEnabled, timeout_seconds: profile.timeoutSeconds, max_output_tokens: profile.maxOutputTokens }); connection.connected(profile); return result; } catch (error) { connection.failed(profile); throw error; } finally { /* Key is deliberately request-scoped and never cached. */ } }
async function testAi(store: AiProfileStore, server: ServerManager, connection: AiConnectionStateStore): Promise<void> { try { const result = await testAiRequest(store, server, connection); vscode.window.showInformationMessage(`AI 连接成功（${result.latency_ms}ms）`); } catch (error) { vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error)); } }
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
    const state = new TaskState(); const bugs = new BugState(); const controller = new TaskLifecycleController(state, () => undefined, message => logger.appendLine(`[task] ${message}`)); const server = new ServerManager(context, logger, logPath);
    const aiProfiles = new AiProfileStore(context.globalState, context.secrets);
    const aiConnection = new AiConnectionStateStore(); context.subscriptions.push(aiConnection);
    activeServer = server;
    const run = (fn: () => Promise<void>) => fn().catch(error => vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error)));
    const recovery = new RecoveryController(state, message => logger.appendLine(`[recovery] ${message}`));
    void startBackendOnActivation(server, logger);
    const events = new EventCaptureController(state, () => server.api, message => logger.appendLine(`[events] ${message}`), () => bugs.activeBugId);
    activeEvents = events;
    const sync = async () => {
      if (!server.api) return;
      const identity = resolveWorkspaceIdentity();
      const result = await recovery.recover(server.api, identity, vscode.workspace.workspaceFolders?.[0]?.uri.fsPath);
      events.setEnabled(result.state === 'ready' && Boolean(state.task));
      if (result.state === 'ready') await synchronizeBugs(state, bugs, server); else bugs.clear();
    };
    const checkSummaryFeature = async () => {
      if (!server.api) return;
      try {
        const health = await server.api.health();
        const supported = Boolean(health.features?.includes('ai-summary-generation-v1'));
        logger.appendLine(`[summary-generation] phase=capability method=GET path=/health status=200 supported=${supported}`);
        if (!supported) vscode.window.showErrorMessage('当前后端版本不支持 AI 总结生成，请重新构建后端。');
      } catch (error) { logger.appendLine(`[summary-generation] phase=capability status=failed error=${error instanceof Error ? error.message.slice(0, 200) : String(error).slice(0, 200)}`); }
    };
    context.subscriptions.push(server.onDidChangeState(change => { const profile = aiProfiles.current(); if (profile && change.state !== 'healthy') aiConnection.notTested(profile); if (change.state === 'healthy') { void sync(); void checkSummaryFeature(); } }));
    if (server.state === 'healthy') void sync();
    const providerView = new Provider(context, state, bugs, server, controller, events, aiProfiles, aiConnection, message => logger.appendLine(message));
    if (context.extensionMode === vscode.ExtensionMode.Test) {
      context.subscriptions.push(vscode.commands.registerCommand('aiWorklog.test.createAiProfile', async (input: { provider: AiProviderKind; baseUrl: string; model: string; apiKey?: string; id?: string; timeoutSeconds?: number }) => { const timestamp = new Date().toISOString(); const id = input.id || `test-ai-${Date.now()}`; const existing = aiProfiles.profiles().find(profile => profile.id === id); const profile: AiProviderProfile = { id, displayName: `Test ${input.provider}`, provider: input.provider, baseUrl: input.baseUrl, model: input.model, thinkingEnabled: false, timeoutSeconds: input.timeoutSeconds || 5, maxOutputTokens: 2048, createdAt: existing?.createdAt || timestamp, updatedAt: timestamp }; await aiProfiles.save(profile, input.apiKey); await aiProfiles.select(profile.id); return { ...profile, apiKey: undefined }; }));
      context.subscriptions.push(vscode.commands.registerCommand('aiWorklog.test.testAiConnection', async () => { const result = await testAiRequest(aiProfiles, server, aiConnection); const profile = aiProfiles.current(); providerView?.testRecordAiViewState(profile, Boolean(profile && await aiProfiles.key(profile.id))); return result; }));
      context.subscriptions.push(vscode.commands.registerCommand('aiWorklog.test.startTask', async () => { const api = await ensureServer(server); const name = `阶段4自动事件验收-${Date.now()}`; const identity = resolveWorkspaceIdentity(); if (!identity) throw new Error('No workspace'); const project = (await api.resolveProject({ name: identity.displayName, workspace_path: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath, workspace_identity_key: identity.canonicalKey, workspace_identity_version: identity.version, workspace_kind: identity.kind, canonical_workspace_uri: identity.canonicalUris[0] })).project; const task = await controller.start(api, { name, project_id: project.id, description: 'Extension Host E2E event capture', requirement_id: 'STAGE-04-E2E', tags: ['stage4', 'e2e', 'event-capture'] }); state.setTask(task); events.setEnabled(true); return task; }));
      context.subscriptions.push(vscode.commands.registerCommand('aiWorklog.test.createBug', async (input: { title: string; severity?: import('./apiClient').BugSeverity; activate?: boolean }) => { if (!state.task) throw new Error('No active task'); const api = await ensureServer(server); const bug = await api.createBug(state.task.id, { title: input.title, severity: input.severity || 'medium', activate_immediately: Boolean(input.activate) }); bugs.replace(toBugRecord(bug)); return bug; }));
      context.subscriptions.push(vscode.commands.registerCommand('aiWorklog.test.activateBug', async (bugId: string) => { if (!state.task) throw new Error('No active task'); const bug = await (await ensureServer(server)).activateBug(state.task.id, bugId); bugs.setCurrent(toBugRecord(bug)); await synchronizeBugs(state, bugs, server); return bug; }));
      context.subscriptions.push(vscode.commands.registerCommand('aiWorklog.test.addBugNote', async (bugId: string, text: string) => { if (!state.task) throw new Error('No active task'); return (await ensureServer(server)).addBugNote(state.task.id, bugId, { client_note_id: `test-${Date.now()}-${Math.random().toString(36).slice(2)}`, text }); }));
      context.subscriptions.push(vscode.commands.registerCommand('aiWorklog.test.resolveBug', async (bugId: string) => { if (!state.task) throw new Error('No active task'); const bug = await (await ensureServer(server)).resolveBug(state.task.id, bugId, { resolution_summary: 'Extension Host E2E resolution' }); bugs.replace(toBugRecord(bug)); return bug; }));
      context.subscriptions.push(vscode.commands.registerCommand('aiWorklog.test.reopenBug', async (bugId: string) => { if (!state.task) throw new Error('No active task'); const bug = await (await ensureServer(server)).reopenBug(state.task.id, bugId); bugs.replace(toBugRecord(bug)); return bug; }));
      context.subscriptions.push(vscode.commands.registerCommand('aiWorklog.test.addManualNote', (note: string) => submitManualNote(state, server, note)));
      context.subscriptions.push(vscode.commands.registerCommand('aiWorklog.test.recordEvent', (type: WorklogEvent['eventType'] = 'manual_note') => events.record(type, { test: 'stage5' })));
      context.subscriptions.push(vscode.commands.registerCommand('aiWorklog.test.flushEvents', () => events.flush()));
      context.subscriptions.push(vscode.commands.registerCommand('aiWorklog.test.restartBackend', () => server.restart()));
      context.subscriptions.push(vscode.commands.registerCommand('aiWorklog.test.endTask', () => endTask(context, state, server, controller, events).then(() => bugs.clearCurrent())));
      context.subscriptions.push(vscode.commands.registerCommand('aiWorklog.test.getRuntimeState', async () => { const task = state.task; const api = server.api; let summary = { total: 0, by_type: {}, latest_event_at: null as string | null }; let recent = { items: [] as WorklogEvent[], total: 0, limit: 100, offset: 0 }; if (task && api) { try { summary = await api.eventSummary(task.id); recent = await api.listEvents(task.id, 100); } catch { /* The test harness can observe the backend error state and restart it. */ } } const profile = aiProfiles.current(); const connection = aiConnection.forProfile(profile); return { extensionMode: context.extensionMode, backendState: server.state, pid: server.pid, port: server.port, backendGeneration: server.backendGeneration, instanceId: server.instanceId, task, bugs: bugs.all, currentBug: bugs.current, summary, recent, pending: events.pendingCount, logPath, dataDir: server.dataDir, recoveryState: recovery.state, aiConnection: connection.connection, aiProfileCount: aiProfiles.profiles().length, aiProfile: profile ? { ...profile, apiKey: undefined, hasKey: Boolean(await aiProfiles.key(profile.id)) } : undefined }; }));
      context.subscriptions.push(vscode.commands.registerCommand('aiWorklog.test.getAiViewState', () => providerView?.testAiViewState()));
      context.subscriptions.push(vscode.commands.registerCommand('aiWorklog.test.refreshAiViewState', () => providerView?.testRefreshAiViewState()));
      context.subscriptions.push(vscode.commands.registerCommand('aiWorklog.test.showAiView', () => { void vscode.commands.executeCommand('workbench.view.extension.aiWorklog'); }));
      context.subscriptions.push(vscode.commands.registerCommand('aiWorklog.test.hideAiView', () => { void vscode.commands.executeCommand('workbench.view.explorer'); }));
    }
    context.subscriptions.push(vscode.commands.registerCommand('aiWorklog.startTask', () => run(() => startTask(context, state, server, controller, events))));
    context.subscriptions.push(vscode.commands.registerCommand('aiWorklog.endTask', () => run(() => endTask(context, state, server, controller, events).then(() => bugs.clearCurrent()))));
    context.subscriptions.push(vscode.commands.registerCommand('aiWorklog.createBug', () => run(() => createBug(state, bugs, server))));
    context.subscriptions.push(vscode.commands.registerCommand('aiWorklog.resolveBug', () => run(() => resolveBug(state, bugs, server))));
    context.subscriptions.push(vscode.commands.registerCommand('aiWorklog.addNote', () => run(() => addNote(state, server))));
    context.subscriptions.push(vscode.commands.registerCommand('aiWorklog.restartServer', () => run(async () => { await server.restart(); vscode.window.showInformationMessage('本地后端已重启'); })));
    context.subscriptions.push(vscode.commands.registerCommand('aiWorklog.showLogs', () => output.show(true)));
    registerContextCommands(context, { api: () => ensureServer(server), configuration: () => vscode.workspace.getConfiguration('aiWorklog').get<number>('aiContext.estimatedInputTokenBudget', 32000) });
    registerGenerationCommands(context, { api: () => ensureServer(server), profiles: aiProfiles, onStatus: job => providerView?.publishGenerationState(job), log: message => logger.appendLine(message) });
    context.subscriptions.push(vscode.commands.registerCommand('aiWorklog.configureAiProvider', () => run(() => configureAi(aiProfiles))));
    context.subscriptions.push(vscode.commands.registerCommand('aiWorklog.switchAiProvider', () => run(async () => { const selected = await promptPick(aiProfiles.profiles().map(profile => ({ label: profile.displayName, description: profile.provider, profile })), { title: '切换 AI Provider' }); if (selected.kind !== 'cancelled') await aiProfiles.select(selected.value.profile.id); })));
    context.subscriptions.push(vscode.commands.registerCommand('aiWorklog.testAiConnection', () => testAi(aiProfiles, server, aiConnection)));
    context.subscriptions.push(vscode.commands.registerCommand('aiWorklog.clearAiApiKey', () => run(async () => { const profile = aiProfiles.current(); if (profile) { await aiProfiles.clearKey(profile.id); vscode.window.showInformationMessage('API Key 已清除'); } })));
    context.subscriptions.push(vscode.commands.registerCommand('aiWorklog.deleteAiProvider', () => run(async () => { const profile = aiProfiles.current(); if (profile) { await aiProfiles.delete(profile.id); vscode.window.showInformationMessage('AI Provider 已删除'); } })));
    context.subscriptions.push(vscode.commands.registerCommand('aiWorklog.openReview', () => vscode.window.showInformationMessage('审核页面将在结束任务后打开')));
    context.subscriptions.push(vscode.commands.registerCommand('aiWorklog.searchKnowledge', () => vscode.window.showInformationMessage('知识库搜索入口已预留')));
    context.subscriptions.push(vscode.window.registerWebviewViewProvider('aiWorklog.sidebar', providerView));
    context.subscriptions.push(events);
    const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left); status.text = '$(pencil) Worklog'; status.command = 'aiWorklog.startTask'; status.show(); context.subscriptions.push(status);
    context.subscriptions.push({ dispose: () => { bugs.dispose(); void events.flush(); void server.shutdown(); } });
  } catch (error) {
    logger.appendLine(`[activation-error] ${error instanceof Error ? error.message : String(error)}`);
    vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
  }
}
export async function deactivate(): Promise<void> {
  const flush = activeEvents?.flush();
  if (flush) await Promise.race([flush, new Promise<void>(resolve => setTimeout(resolve, 2000))]);
  await activeServer?.shutdown();
  activeEvents = undefined;
  activeServer = undefined;
}
