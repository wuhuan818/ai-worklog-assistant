import * as vscode from 'vscode';
import { EventBuffer, BufferedEvent } from '../eventBuffer';
import { ApiClient, WorklogEventType } from '../apiClient';
import { TaskState } from '../taskState';
import { relativeFilePath, safePayload } from './eventSanitizer';

export class EventCaptureController implements vscode.Disposable {
  private readonly subscriptions: vscode.Disposable[] = [];
  private readonly buffer: EventBuffer;
  private taskId?: string;
  constructor(private readonly state: TaskState, private readonly api: () => ApiClient | undefined, private readonly log: (message: string) => void = () => undefined) {
    this.buffer = new EventBuffer(async (taskId, events) => { const client = this.api(); if (!client) throw new Error('backend unavailable'); await client.batchEvents(taskId, events); });
    this.subscriptions.push(vscode.workspace.onDidSaveTextDocument(document => this.emit('file_saved', document.uri, { language_id: document.languageId, file_size: document.getText().length })));
    this.subscriptions.push(vscode.workspace.onDidChangeTextDocument(event => { if (event.contentChanges.length) this.emit('file_changed', event.document.uri, { language_id: event.document.languageId, change_count: event.contentChanges.length, dirty: event.document.isDirty }); }));
    this.subscriptions.push(vscode.languages.onDidChangeDiagnostics(event => { for (const uri of event.uris) { const diagnostics = vscode.languages.getDiagnostics(uri); const counts = [0,0,0,0]; const items = diagnostics.slice(0,100).map(d => { counts[d.severity - 1]++; return { severity: d.severity, message: d.message.slice(0,500), source: d.source, code: d.code, range: { start: d.range.start, end: d.range.end } }; }); this.emit('diagnostics_changed', uri, { error_count: counts[0], warning_count: counts[1], information_count: counts[2], hint_count: counts[3], diagnostics: items, truncated: diagnostics.length > 100 }); } }));
    this.subscriptions.push(vscode.tasks.onDidStartTask(e => this.emit('vscode_task_started', undefined, { name: e.execution.task.name, definition_type: e.execution.task.definition.type })));
    this.subscriptions.push(vscode.tasks.onDidEndTask(e => this.emit('vscode_task_ended', undefined, { name: e.execution.task.name })));
    this.subscriptions.push(vscode.debug.onDidStartDebugSession(s => this.emit('debug_session_started', undefined, { id: s.id, name: s.name, type: s.type, request: s.configuration.request })));
    this.subscriptions.push(vscode.debug.onDidTerminateDebugSession(s => this.emit('debug_session_terminated', undefined, { id: s.id, name: s.name, type: s.type })));
    this.subscriptions.push(vscode.debug.onDidChangeActiveDebugSession(s => this.emit('debug_active_session_changed', undefined, { id: s?.id || null, name: s?.name || null })));
  }
  private emit(type: WorklogEventType, uri: vscode.Uri | undefined, payload: Record<string, unknown>): void { const task = this.state.task; if (!task || !this.api()) return; const file = uri ? relativeFilePath(uri) : {}; if (uri && !file.filePath) return; const event: BufferedEvent = { client_event_id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, event_type: type, source: 'vscode', taskId: task.id, occurred_at: new Date().toISOString(), ...file, payload: safePayload(payload) }; this.buffer.add(event); }
  async flush(): Promise<void> { await this.buffer.flush(); }
  record(type: WorklogEventType, payload: Record<string, unknown> = {}): void { this.emit(type, undefined, payload); }
  dispose(): void { this.subscriptions.forEach(s => s.dispose()); void this.buffer.dispose(); }
}
