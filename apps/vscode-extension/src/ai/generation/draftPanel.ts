import * as crypto from 'node:crypto';
import * as vscode from 'vscode';
import { SummaryDraft } from './types';

const labels = { task_summary: 'Task Summary', code_changes: 'Code Changes', commands_and_results: 'Commands and Results', bug_solutions: 'Bug Solutions', unresolved_issues: 'Unresolved Issues', todos: 'To-dos', daily_report: 'Daily Report', knowledge_candidates: 'Knowledge Candidates' } as const;
const sectionOrder = Object.keys(labels) as Array<keyof typeof labels>;
const escape = (value: unknown): string => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] ?? c));
export function summaryDraftHtml(nonce: string): string { return `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'"><style nonce="${nonce}">body{font-family:var(--vscode-font-family);padding:16px}section{border-top:1px solid var(--vscode-editorWidget-border);padding:10px 0}pre{white-space:pre-wrap;word-break:break-word}</style></head><body><h2>AI Summary Draft</h2><p id="meta"></p><main id="content"></main><script nonce="${nonce}">window.addEventListener('message',e=>{const d=e.data;if(d.type!=='draft')return;document.getElementById('meta').textContent=d.meta;document.getElementById('content').innerHTML=d.html;});</script></body></html>`; }
export class SummaryDraftPanel implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = []; private disposed = false;
  constructor(private readonly panel: vscode.WebviewPanel, onDisposed?: () => void) { const nonce = crypto.randomBytes(16).toString('hex'); panel.webview.options = { enableScripts: true }; panel.webview.html = summaryDraftHtml(nonce); this.disposables.push(panel.onDidDispose(() => { this.disposed = true; onDisposed?.(); })); }
  get isDisposed(): boolean { return this.disposed; }
  show(draft: SummaryDraft): void { if (this.disposed) return; const sections = ((draft.content_json || draft.content)?.sections || {}) as Record<keyof typeof labels, unknown>; const html = sectionOrder.map(key => `<section><h3>${labels[key]}</h3><pre>${escape(JSON.stringify(sections[key] ?? (key === 'task_summary' || key === 'daily_report' ? {} : []), null, 2))}</pre></section>`).join(''); const meta = `${draft.provider || '-'} / ${draft.model || '-'} · ${draft.schema_version}`; void this.panel.webview.postMessage({ type: 'draft', meta, html }); this.panel.reveal(vscode.ViewColumn.Active); }
  dispose(): void { if (this.disposed) return; this.disposed = true; this.disposables.splice(0).forEach(item => item.dispose()); this.panel.dispose(); }
}
