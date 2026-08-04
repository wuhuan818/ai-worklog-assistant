import { ContextPackage } from './types';

const blockedKey = /^(?:api[ _-]?key|authorization|cookie|password|passwd|secret|credential|private.?key)$/i;
const numericMetadata = new Set(['estimated_tokens', 'estimated_tokens_before', 'estimated_tokens_after', 'estimated_token_budget', 'redaction_count', 'truncation_count', 'occurrence_count', 'active_duration_seconds']);
function safeValue(value: unknown, key?: string): unknown {
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return value;
  if (key && numericMetadata.has(key)) return value;
  if (key && blockedKey.test(key)) return '<redacted>';
  if (Array.isArray(value)) return value.map(item => safeValue(item));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([childKey, entry]) => [childKey, safeValue(entry, childKey)]));
  return value;
}
/** Defense in depth: preview never receives a secret-shaped property. */
export function previewPayload(contextPackage: ContextPackage): Record<string, unknown> {
  return safeValue({ id: contextPackage.id, status: contextPackage.status, content_hash: contextPackage.content_hash, estimated_tokens: contextPackage.estimated_tokens, context: contextPackage.context }) as Record<string, unknown>;
}
export function readyEligibility(contextPackage: ContextPackage): { allowed: boolean; reason: string } {
  const context = contextPackage.context;
  const budget = context?.budget as Record<string, unknown> | undefined;
  const privacy = context?.privacy as Record<string, unknown> | undefined;
  const task = context?.task as Record<string, unknown> | undefined;
  const allowed = contextPackage.status === 'preview' && Boolean(task && Object.keys(task).length > 0 && privacy && budget && privacy.raw_secret_retained === false && typeof contextPackage.estimated_tokens === 'number' && Number.isFinite(contextPackage.estimated_tokens) && typeof budget.estimated_token_budget === 'number' && contextPackage.estimated_tokens <= budget.estimated_token_budget);
  return { allowed, reason: allowed ? '' : 'Context 无效、超预算或不允许标记 Ready' };
}
export function previewHtml(nonce: string): string {
  const csp = `default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';`;
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><meta name="viewport" content="width=device-width,initial-scale=1"><style nonce="${nonce}">body{font-family:var(--vscode-font-family);padding:14px}pre{white-space:pre-wrap;word-break:break-word;background:var(--vscode-textCodeBlock-background);padding:12px}button{margin-right:8px}</style></head><body><h2>AI Context Package</h2><p id="summary">加载中…</p><p id="readyReason"></p><button id="ready" disabled>标记 Ready</button><pre id="content"></pre><script nonce="${nonce}">const vscode=acquireVsCodeApi();const summary=document.getElementById('summary');const content=document.getElementById('content');const ready=document.getElementById('ready');const readyReason=document.getElementById('readyReason');ready.addEventListener('click',()=>{if(!ready.disabled)vscode.postMessage({type:'markReady'})});window.addEventListener('message',event=>{const m=event.data;if(m.type!=='context')return;summary.textContent='状态：'+m.payload.status+' · 估算 Token：'+(m.payload.estimated_tokens??'-');content.textContent=JSON.stringify(m.payload,null,2);ready.disabled=m.payload.ready_allowed!==true;readyReason.textContent=m.payload.ready_reason||'';});</script></body></html>`;
}
