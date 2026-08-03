import { ContextPackage } from './types';

const blockedKey = /(?:api[ _-]?key|authorization|cookie|password|passwd|secret|token|credential|private.?key)/i;
function safeValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(safeValue);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, entry]) => [key, blockedKey.test(key) ? '<redacted>' : safeValue(entry)]));
  return value;
}
/** Defense in depth: preview never receives a secret-shaped property. */
export function previewPayload(contextPackage: ContextPackage): Record<string, unknown> {
  const context = contextPackage.context ?? contextPackage.context_json ?? {};
  return safeValue({ id: contextPackage.context_id || contextPackage.id, status: contextPackage.status, content_hash: contextPackage.content_hash, estimated_tokens: contextPackage.estimated_tokens, context }) as Record<string, unknown>;
}
export function previewHtml(nonce: string): string {
  const csp = `default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';`;
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><meta name="viewport" content="width=device-width,initial-scale=1"><style nonce="${nonce}">body{font-family:var(--vscode-font-family);padding:14px}pre{white-space:pre-wrap;word-break:break-word;background:var(--vscode-textCodeBlock-background);padding:12px}button{margin-right:8px}</style></head><body><h2>AI Context Package</h2><p id="summary">加载中…</p><button id="ready">标记 Ready</button><pre id="content"></pre><script nonce="${nonce}">const vscode=acquireVsCodeApi();const summary=document.getElementById('summary');const content=document.getElementById('content');document.getElementById('ready').addEventListener('click',()=>vscode.postMessage({type:'markReady'}));window.addEventListener('message',event=>{const m=event.data;if(m.type!=='context')return;summary.textContent='状态：'+m.payload.status+' · 估算 Token：'+(m.payload.estimated_tokens??'-');content.textContent=JSON.stringify(m.payload,null,2);document.getElementById('ready').disabled=m.payload.status==='ready';});</script></body></html>`;
}
