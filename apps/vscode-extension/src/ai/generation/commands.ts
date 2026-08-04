import * as crypto from 'node:crypto';
import * as vscode from 'vscode';
import { ApiClient, ApiError, TaskView } from '../../apiClient';
import { AiProfileStore } from '../profileStore';
import { ContextClient } from '../context/client';
import { ContextPackage } from '../context/types';
import { GenerationClient } from './client';
import { SummaryDraftPanel } from './draftPanel';
import { GenerationJob, generationStatusLabel } from './types';
import { confirmationText, generationConfirmation } from './viewModel';

export interface GenerationCommandDeps { api(): Promise<ApiClient>; profiles: AiProfileStore; onStatus?(job: GenerationJob | undefined): void; log?(message: string): void; }
const shortId = (value: string | undefined) => value ? value.slice(0, 12) : '-';
export function generationErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 404 && !error.errorCode) return 'AI 生成接口在当前后端中不可用，请重新构建后端。';
    return ({ context_not_found: '未找到所选 Ready Context。', context_not_ready: '所选 Context 不是 Ready 状态。', task_not_found: '所选任务不存在。', provider_key_missing: '所选 AI Profile 未配置 API Key。', provider_not_configured: '当前后端未配置 AI 总结生成能力。' } as Record<string, string>)[error.errorCode || ''] || `AI 总结生成请求失败（HTTP ${error.status}）。`;
  }
  return error instanceof Error ? error.message : String(error);
}
const taskPicker = async (api: ApiClient): Promise<TaskView | undefined> => vscode.window.showQuickPick((await api.listTasks('completed')).map(task => ({ label: task.name, description: task.ended_at ? new Date(task.ended_at).toLocaleString() : '', task })), { title: 'Select completed task' }).then(choice => choice?.task);
const readyContext = async (api: ApiClient, task: TaskView): Promise<ContextPackage | undefined> => { const options = (await new ContextClient(api).list(task.id)).filter(item => item.status === 'ready').map(item => ({ label: `${item.content_hash.slice(0, 12)}…`, description: `${item.estimated_tokens} input tokens`, item })); if (!options.length) { vscode.window.showWarningMessage('No Ready AI Context Package exists for this task.'); return; } return options.length === 1 ? options[0].item : vscode.window.showQuickPick(options, { title: 'Select Ready Context Package' }).then(choice => choice?.item); };
function confirmation(contextPackage: ContextPackage, task: TaskView, profile: Parameters<typeof generationConfirmation>[2]): Thenable<string | undefined> { return vscode.window.showWarningMessage(confirmationText(generationConfirmation(task.name, contextPackage, profile)), { modal: true }, 'Generate summary draft'); }
export function registerGenerationCommands(context: vscode.ExtensionContext, deps: GenerationCommandDeps): void {
  let panel: SummaryDraftPanel | undefined; let runningJobId: string | undefined;
  const openDraft = async (task?: TaskView) => { const api = await deps.api(); const selected = task || await taskPicker(api); if (!selected) return; const drafts = await new GenerationClient(api).drafts(selected.id); if (!drafts.length) { vscode.window.showInformationMessage('No AI summary drafts exist for this task.'); return; } const draft = drafts[0]; if (!panel || panel.isDisposed) { const view = vscode.window.createWebviewPanel('aiWorklog.summaryDraft', 'AI Summary Draft', vscode.ViewColumn.Active, { enableScripts: true }); panel = new SummaryDraftPanel(view, () => { panel = undefined; }); context.subscriptions.push(panel); } panel.show(draft); };
  context.subscriptions.push(vscode.commands.registerCommand('aiWorklog.generateAiSummaryDraft', async () => {
    if (runningJobId) { vscode.window.showInformationMessage('An AI summary generation is already running.'); return; }
    const api = await deps.api();
    try {
      const health = await api.health();
      deps.log?.(`[summary-generation] phase=capability method=GET path=/health status=200 features=${(health.features || []).join(',')}`);
      if (!health.features?.includes('ai-summary-generation-v1')) { vscode.window.showErrorMessage('当前后端版本不支持 AI 总结生成，请重新构建后端。'); return; }
    } catch (error) { vscode.window.showErrorMessage(generationErrorMessage(error)); return; }
    const task = await taskPicker(api); if (!task) return;
    const packageToSend = await readyContext(api, task); if (!packageToSend) return;
    const profile = deps.profiles.current(); if (!profile) { vscode.window.showWarningMessage('Configure an AI Provider Profile first.'); return; }
    // SecretStorage is intentionally read only after explicit confirmation.
    if (await confirmation(packageToSend, task, profile) !== 'Generate summary draft') return;
    const apiKey = await deps.profiles.key(profile.id); if (!apiKey) { vscode.window.showWarningMessage('The selected AI Provider Profile has no API key.'); return; }
    const client = new GenerationClient(api); let progress: vscode.Progress<{ message?: string; increment?: number }> | undefined;
    try { await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Generating AI summary draft', cancellable: false }, async report => { progress = report; deps.log?.(`[summary-generation] phase=create method=POST path=/ai/context-packages/${shortId(packageToSend.id)}/summary-generations task=${shortId(task.id)} context=${shortId(packageToSend.id)} profile=${shortId(profile.id)}`); const created = await client.create(packageToSend.id, { profile_id: profile.id, provider: profile.provider, base_url: profile.baseUrl, model: profile.model, thinking_enabled: profile.thinkingEnabled, timeout_seconds: profile.timeoutSeconds, max_output_tokens: profile.maxOutputTokens, api_key: apiKey }, crypto.randomUUID()); runningJobId = created.job_id || created.id; if (!runningJobId) throw new Error('Backend did not return a generation job id'); deps.onStatus?.(created); const result = await client.wait(runningJobId, job => { deps.onStatus?.(job); progress?.report({ message: generationStatusLabel(job.status) }); }); if (result.status !== 'succeeded') throw new Error(result.error_summary || `Generation ${result.status}`); vscode.window.showInformationMessage('AI summary draft generated.'); await openDraft(task); }); } catch (error) { const message = generationErrorMessage(error); const detail = error instanceof ApiError ? ` status=${error.status} code=${error.errorCode || '-'}` : ''; deps.log?.(`[summary-generation] phase=failed${detail} task=${shortId(task.id)} context=${shortId(packageToSend.id)} profile=${shortId(profile.id)}`); vscode.window.showErrorMessage(message); } finally { runningJobId = undefined; }
  }));
  context.subscriptions.push(vscode.commands.registerCommand('aiWorklog.viewAiSummaryDrafts', () => openDraft()));
  context.subscriptions.push(vscode.commands.registerCommand('aiWorklog.cancelAiSummaryGeneration', async () => { if (!runningJobId) { vscode.window.showInformationMessage('No AI summary generation is running.'); return; } const job = await new GenerationClient(await deps.api()).cancel(runningJobId); deps.onStatus?.(job); vscode.window.showInformationMessage('AI summary generation cancelled.'); }));
}
