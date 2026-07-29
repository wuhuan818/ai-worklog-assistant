import * as vscode from 'vscode';
import { backendStateLabel } from './backendState';
import { ServerManager } from './serverManager';
import { TaskState } from './taskState';

class Provider implements vscode.WebviewViewProvider {
  constructor(private readonly context: vscode.ExtensionContext, private readonly state: TaskState, private readonly server: ServerManager) {}
  resolveWebviewView(view: vscode.WebviewView): void {
    view.webview.options = { enableScripts: true };
    const stateLabel = () => backendStateLabel(this.server.state);
    view.webview.html = `<h3>AI Worklog</h3><p id="backend">后端状态：${stateLabel()}</p><p id="task">当前任务：${this.state.label()}</p><p id="bug">当前 Bug：暂无 Bug</p><button id="startServer">启动后端</button><button id="restartServer">重启后端</button><button id="start">开始任务</button><button id="end">结束任务</button><button id="note">添加备注</button><script>const vscode=acquireVsCodeApi();const send=type=>vscode.postMessage({type});startServer.onclick=()=>send('startServer');restartServer.onclick=()=>send('restartServer');start.onclick=()=>send('start');end.onclick=()=>send('end');note.onclick=()=>send('note');window.addEventListener('message',event=>{if(event.data.type==='backendState'){document.getElementById('backend').textContent='后端状态：'+event.data.label;}});</script>`;
    const stateSubscription = this.server.onDidChangeState(change => { void view.webview.postMessage({ type: 'backendState', state: change.state, label: backendStateLabel(change.state), error: change.error }); });
    this.context.subscriptions.push(stateSubscription);
    view.onDidDispose(() => stateSubscription.dispose());
    view.webview.onDidReceiveMessage(async message => {
      try {
        if (message.type === 'start') await startTask(this.context, this.state, this.server);
        if (message.type === 'end') await endTask(this.context, this.state, this.server);
        if (message.type === 'note') await addNote(this.state, this.server);
        if (message.type === 'startServer') await ensureServer(this.server);
        if (message.type === 'restartServer') await this.server.restart();
      } catch (error) { vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error)); }
    });
  }
}

async function ensureServer(server: ServerManager) { try { return await server.start(); } catch (error) { vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error)); throw error; } }
async function startTask(_context: vscode.ExtensionContext, state: TaskState, server: ServerManager): Promise<void> {
  const name = await vscode.window.showInputBox({ prompt: '任务名称' }); if (!name) return;
  const api = await ensureServer(server); const task = await api.createTask({ name, project: vscode.workspace.name || '未命名项目' }); state.setTask(task);
  await api.addEvent({ projectId: task.project_id, taskId: task.id, type: 'task_started', timestamp: new Date().toISOString(), payload: { name } });
  vscode.window.showInformationMessage(`已开始记录：${name}`);
}
async function endTask(context: vscode.ExtensionContext, state: TaskState, server: ServerManager): Promise<void> {
  if (!state.task) { vscode.window.showWarningMessage('当前没有活动任务'); return; }
  const api = await ensureServer(server); const task = await api.endTask(state.task.id); state.setTask(task); const draft = await api.generateSummary(task.id);
  vscode.window.showInformationMessage(`已生成总结草稿：${String((draft as { id?: string }).id || '')}`);
}
async function createBug(state: TaskState, server: ServerManager): Promise<void> {
  if (!state.task) { vscode.window.showWarningMessage('当前没有活动任务'); return; }
  const title = await vscode.window.showInputBox({ prompt: 'Bug 标题' }); if (!title) return; const bug = await (await ensureServer(server)).createBug(state.task.id, title); vscode.window.showInformationMessage(`已创建 Bug：${String(bug.title)}`);
}
async function resolveBug(server: ServerManager): Promise<void> {
  const id = await vscode.window.showInputBox({ prompt: 'Bug ID' }); if (!id) return; await (await ensureServer(server)).resolveBug(id); vscode.window.showInformationMessage('Bug 已解决');
}
async function addNote(state: TaskState, server: ServerManager): Promise<void> {
  if (!state.task) { vscode.window.showWarningMessage('当前没有活动任务'); return; }
  const note = await vscode.window.showInputBox({ prompt: '备注' }); if (!note) return; await (await ensureServer(server)).addEvent({ projectId: state.task.project_id, taskId: state.task.id, type: 'manual_note', timestamp: new Date().toISOString(), payload: { note } });
}

let activeServer: ServerManager | undefined;

export function activate(context: vscode.ExtensionContext): void {
  const state = new TaskState(); const server = new ServerManager(context);
  activeServer = server;
  const run = (fn: () => Promise<void>) => fn().catch(error => vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error)));
  context.subscriptions.push(vscode.commands.registerCommand('aiWorklog.startTask', () => run(() => startTask(context, state, server))));
  context.subscriptions.push(vscode.commands.registerCommand('aiWorklog.endTask', () => run(() => endTask(context, state, server))));
  context.subscriptions.push(vscode.commands.registerCommand('aiWorklog.createBug', () => run(() => createBug(state, server))));
  context.subscriptions.push(vscode.commands.registerCommand('aiWorklog.resolveBug', () => run(() => resolveBug(server))));
  context.subscriptions.push(vscode.commands.registerCommand('aiWorklog.addNote', () => run(() => addNote(state, server))));
  context.subscriptions.push(vscode.commands.registerCommand('aiWorklog.restartServer', () => run(async () => { await server.restart(); vscode.window.showInformationMessage('本地后端已重启'); })));
  context.subscriptions.push(vscode.commands.registerCommand('aiWorklog.openReview', () => vscode.window.showInformationMessage('审核页面将在结束任务后打开')));
  context.subscriptions.push(vscode.commands.registerCommand('aiWorklog.searchKnowledge', () => vscode.window.showInformationMessage('知识库搜索入口已预留')));
  context.subscriptions.push(vscode.window.registerWebviewViewProvider('aiWorklog.sidebar', new Provider(context, state, server)));
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left); status.text = '$(pencil) Worklog'; status.command = 'aiWorklog.startTask'; status.show(); context.subscriptions.push(status);
  context.subscriptions.push(vscode.workspace.onDidSaveTextDocument(document => { if (state.task && server.api) server.api.addEvent({ projectId: state.task.project_id, taskId: state.task.id, type: 'file_saved', timestamp: new Date().toISOString(), payload: { file: document.uri.fsPath } }).catch(() => undefined); }));
  context.subscriptions.push({ dispose: () => { void server.stop(); } });
}
export async function deactivate(): Promise<void> { await activeServer?.stop(); activeServer = undefined; }
