import * as crypto from 'node:crypto';
import * as vscode from 'vscode';
import { ApiClient, TaskView } from '../../apiClient';
import { ContextClient } from './client';
import { PreviewPanel } from './preview';
import { defaultBuildConfig, validBudget } from './types';

export interface ContextCommandDeps { api(): Promise<ApiClient>; configuration(): number; }
async function selectCompletedTask(client: ContextClient): Promise<TaskView | undefined> {
  const tasks = await client.listCompletedTasks();
  return vscode.window.showQuickPick(tasks.map(task => ({ label: task.name, description: task.ended_at ? `结束于 ${new Date(task.ended_at).toLocaleString()}` : '已结束', task })), { title: '选择已结束任务', matchOnDescription: true }).then(choice => choice?.task);
}
export function registerContextCommands(context: vscode.ExtensionContext, deps: ContextCommandDeps): void {
  let preview: PreviewPanel | undefined;
  const open = async (rebuild: boolean) => {
    const client = new ContextClient(await deps.api()); const task = await selectCompletedTask(client); if (!task) return;
    let packageToShow = rebuild ? undefined : (await client.list(task.id)).find(item => item.status === 'preview' || item.status === 'ready');
    if (!packageToShow) packageToShow = await client.build(task.id, defaultBuildConfig(validBudget(deps.configuration())), crypto.randomUUID());
    if (!preview) { const panel = vscode.window.createWebviewPanel('aiWorklog.contextPreview', 'AI Context Preview', vscode.ViewColumn.Active, { enableScripts: true }); preview = new PreviewPanel(panel, async contextId => { const ready = await (new ContextClient(await deps.api())).ready(contextId); preview?.show(ready); vscode.window.showInformationMessage('AI 上下文已标记为 Ready'); }); context.subscriptions.push(preview); }
    preview.show(packageToShow);
  };
  context.subscriptions.push(vscode.commands.registerCommand('aiWorklog.previewAiContext', () => open(false)));
  context.subscriptions.push(vscode.commands.registerCommand('aiWorklog.rebuildAiContext', () => open(true)));
  context.subscriptions.push(vscode.commands.registerCommand('aiWorklog.markAiContextReady', async () => {
    const client = new ContextClient(await deps.api()); const task = await selectCompletedTask(client); if (!task) return; const packages = (await client.list(task.id)).filter(item => item.status === 'preview'); const chosen = await vscode.window.showQuickPick(packages.map(item => ({ label: item.content_hash.slice(0, 12), description: `估算 Token：${item.estimated_tokens ?? '-'}`, item })), { title: '选择 Preview Context Package' }); if (!chosen) return; const ready = await client.ready(chosen.item.context_id || chosen.item.id); preview?.show(ready); vscode.window.showInformationMessage('AI 上下文已标记为 Ready');
  }));
}
