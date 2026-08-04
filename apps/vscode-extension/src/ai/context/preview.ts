import * as crypto from 'node:crypto';
import * as vscode from 'vscode';
import { ContextPackage } from './types';
import { previewHtml, previewPayload, readyEligibility } from './previewModel';
export { previewHtml, previewPayload, readyEligibility } from './previewModel';
export class PreviewPanel implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private disposed = false;
  private contextId?: string;
  private readyAllowed = false;
  private readyInFlight = false;
  constructor(private readonly panel: vscode.WebviewPanel, private readonly onReady: (contextId: string) => Promise<void>, private readonly onDisposed?: () => void) {
    const nonce = crypto.randomBytes(16).toString('hex');
    panel.webview.options = { enableScripts: true };
    // Assign the immutable shell once. All package updates use postMessage.
    panel.webview.html = previewHtml(nonce);
    this.disposables.push(panel.webview.onDidReceiveMessage(async message => {
      if (message?.type !== 'markReady' || !this.contextId || !this.readyAllowed || this.readyInFlight || this.disposed) return;
      this.readyInFlight = true;
      try { await this.onReady(this.contextId); } finally { this.readyInFlight = false; }
    }));
    this.disposables.push(panel.onDidDispose(() => this.dispose()));
  }
  get isDisposed(): boolean { return this.disposed; }
  show(contextPackage: ContextPackage): void {
    if (this.disposed) return;
    const eligibility = readyEligibility(contextPackage);
    this.readyAllowed = eligibility.allowed;
    this.contextId = contextPackage.id;
    void this.panel.webview.postMessage({ type: 'context', payload: { ...previewPayload(contextPackage), ready_allowed: this.readyAllowed, ready_reason: eligibility.reason } });
    this.panel.reveal(vscode.ViewColumn.Active);
  }
  dispose(): void { if (this.disposed) return; this.disposed = true; this.disposables.splice(0).forEach(disposable => disposable.dispose()); this.onDisposed?.(); }
}
