import * as crypto from 'node:crypto';
import * as vscode from 'vscode';
import { ContextPackage } from './types';
import { previewHtml, previewPayload } from './previewModel';
export { previewHtml, previewPayload } from './previewModel';
export class PreviewPanel implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private disposed = false;
  constructor(private readonly panel: vscode.WebviewPanel, onReady: (contextId: string) => Promise<void>) {
    const nonce = crypto.randomBytes(16).toString('hex');
    panel.webview.options = { enableScripts: true };
    // Assign the immutable shell once. All package updates use postMessage.
    panel.webview.html = previewHtml(nonce);
    this.disposables.push(panel.webview.onDidReceiveMessage(async message => { if (message?.type === 'markReady' && this.contextId) await onReady(this.contextId); }));
    this.disposables.push(panel.onDidDispose(() => this.dispose()));
  }
  private contextId?: string;
  show(contextPackage: ContextPackage): void { this.contextId = contextPackage.context_id || contextPackage.id; void this.panel.webview.postMessage({ type: 'context', payload: previewPayload(contextPackage) }); this.panel.reveal(vscode.ViewColumn.Active); }
  dispose(): void { if (this.disposed) return; this.disposed = true; this.disposables.splice(0).forEach(disposable => disposable.dispose()); }
}
