import * as path from 'node:path';
import * as vscode from 'vscode';
import { EventBuffer, BufferedEvent } from '../eventBuffer';
import { ApiClient, WorklogEventType } from '../apiClient';
import { TaskState } from '../taskState';
import { relativeFilePath, safePayload } from './eventSanitizer';
import { captureEligibility, CodeCaptureLimits, DEFAULT_MAX_DIFF_BYTES, DEFAULT_MAX_FILE_SIZE_BYTES } from './codeDiff';
import { SaveDiffTracker } from './saveDiffTracker';
import { CaptureGate } from './captureGate';
import { DEFAULT_MAX_TERMINAL_COMMAND_BYTES, HARD_MAX_TERMINAL_COMMAND_BYTES, sanitizeTerminalCwd, TerminalCommandOwnership, TerminalCommandTracker } from './terminalCommand';

export type CurrentBugIdProvider = () => string | undefined;

export class EventCaptureController implements vscode.Disposable {
  private readonly subscriptions: vscode.Disposable[] = [];
  private readonly savedBaselines = new SaveDiffTracker();
  private readonly terminalCommands = new TerminalCommandTracker();
  private readonly captureGate = new CaptureGate();
  private readonly buffer: EventBuffer;
  constructor(
    private readonly state: TaskState,
    private readonly api: () => ApiClient | undefined,
    private readonly log: (message: string) => void = () => undefined,
    private readonly currentBugId: CurrentBugIdProvider = () => undefined,
  ) {
    const configuredInterval = Number(vscode.workspace.getConfiguration('aiWorklog.eventCapture').get<number>('flushIntervalMs', 2_000));
    const flushIntervalMs = Number.isFinite(configuredInterval) ? Math.max(100, Math.min(Math.floor(configuredInterval), 60_000)) : 2_000;
    this.buffer = new EventBuffer(async (taskId, events) => { const client = this.api(); if (!client) throw new Error('backend unavailable'); await client.batchEvents(taskId, events); }, 500, 50, flushIntervalMs);
    this.subscriptions.push(vscode.workspace.onDidOpenTextDocument(document => this.primeBaseline(document)));
    this.subscriptions.push(vscode.workspace.onDidCloseTextDocument(document => this.savedBaselines.delete(document.uri.toString())));
    this.subscriptions.push(vscode.workspace.onDidDeleteFiles(event => event.files.forEach(uri => this.savedBaselines.delete(uri.toString()))));
    this.subscriptions.push(vscode.workspace.onDidRenameFiles(event => event.files.forEach(file => {
      this.savedBaselines.delete(file.oldUri.toString());
      const document = vscode.workspace.textDocuments.find(item => item.uri.toString() === file.newUri.toString());
      if (document) this.primeBaseline(document);
    })));
    this.subscriptions.push(vscode.workspace.onDidSaveTextDocument(document => this.captureSavedDocument(document)));
    this.subscriptions.push(vscode.workspace.onDidChangeTextDocument(event => {
      if (!this.captureGate.accepting || !event.contentChanges.length || !this.isEligible(event.document)) return;
      const inserted = event.contentChanges.reduce((sum, change) => sum + change.text.length, 0);
      const deleted = event.contentChanges.reduce((sum, change) => sum + change.rangeLength, 0);
      this.emit('file_changed', event.document.uri, { language_id: event.document.languageId, change_count: event.contentChanges.length, inserted_character_count: inserted, deleted_character_count: deleted, dirty: event.document.isDirty });
    }));
    this.subscriptions.push(vscode.languages.onDidChangeDiagnostics(event => { for (const uri of event.uris) { const diagnostics = vscode.languages.getDiagnostics(uri); const counts = [0,0,0,0]; const items = diagnostics.slice(0,100).map(d => { counts[d.severity - 1]++; return { severity: d.severity, message: d.message.slice(0,500), source: d.source, code: d.code, range: { start: d.range.start, end: d.range.end } }; }); this.emit('diagnostics_changed', uri, { error_count: counts[0], warning_count: counts[1], information_count: counts[2], hint_count: counts[3], diagnostics: items, truncated: diagnostics.length > 100 }); } }));
    this.subscriptions.push(vscode.tasks.onDidStartTask(e => this.emit('vscode_task_started', undefined, { name: e.execution.task.name, definition_type: e.execution.task.definition.type })));
    this.subscriptions.push(vscode.tasks.onDidStartTaskProcess(e => this.emit('vscode_task_process_started', undefined, { name: e.execution.task.name, process_id: e.processId ?? null })));
    this.subscriptions.push(vscode.tasks.onDidEndTaskProcess(e => this.emit('vscode_task_process_ended', undefined, { name: e.execution.task.name, process_id: null, exit_code: e.exitCode ?? null })));
    this.subscriptions.push(vscode.tasks.onDidEndTask(e => this.emit('vscode_task_ended', undefined, { name: e.execution.task.name })));
    this.subscriptions.push(vscode.window.onDidStartTerminalShellExecution(event => this.captureTerminalCommandStart(event)));
    this.subscriptions.push(vscode.window.onDidEndTerminalShellExecution(event => this.captureTerminalCommandEnd(event)));
    this.subscriptions.push(vscode.debug.onDidStartDebugSession(s => this.emit('debug_session_started', undefined, { id: s.id, name: s.name, type: s.type, request: s.configuration.request })));
    this.subscriptions.push(vscode.debug.onDidTerminateDebugSession(s => this.emit('debug_session_terminated', undefined, { id: s.id, name: s.name, type: s.type })));
    this.subscriptions.push(vscode.debug.onDidChangeActiveDebugSession(s => this.emit('debug_active_session_changed', undefined, { id: s?.id || null, name: s?.name || null })));
  }
  private terminalCaptureEnabled(): boolean {
    return vscode.workspace.getConfiguration('aiWorklog.eventCapture').get<boolean>('terminalCommands', true);
  }
  private maxTerminalCommandBytes(): number {
    const configured = Number(vscode.workspace.getConfiguration('aiWorklog.eventCapture').get<number>('maxTerminalCommandBytes', DEFAULT_MAX_TERMINAL_COMMAND_BYTES));
    return Number.isFinite(configured) ? Math.max(256, Math.min(Math.floor(configured), HARD_MAX_TERMINAL_COMMAND_BYTES)) : DEFAULT_MAX_TERMINAL_COMMAND_BYTES;
  }
  private relativeTerminalCwd(uri: vscode.Uri | undefined): string | undefined {
    if (!uri) return undefined;
    const folder = vscode.workspace.getWorkspaceFolder(uri);
    if (!folder || folder.uri.scheme !== uri.scheme) return undefined;
    const relative = path.relative(folder.uri.fsPath, uri.fsPath).replaceAll('\\', '/');
    if (!relative) return '.';
    const normalized = sanitizeTerminalCwd(relative);
    if (!normalized || path.isAbsolute(normalized) || normalized === '..' || normalized.startsWith('../') || Buffer.byteLength(normalized, 'utf8') > 1024) return undefined;
    return normalized;
  }
  private captureTerminalCommandStart(event: vscode.TerminalShellExecutionStartEvent): void {
    const task = this.state.task;
    if (!this.captureGate.accepting || !this.terminalCaptureEnabled() || !task || task.status !== 'active') return;
    const bugId = this.currentBugId();
    this.terminalCommands.begin(event.execution, {
      taskId: task.id,
      ...(bugId ? { bugId } : {}),
      startedAt: new Date().toISOString(),
      cwd: this.relativeTerminalCwd(event.execution.cwd),
    });
  }
  private captureTerminalCommandEnd(event: vscode.TerminalShellExecutionEndEvent): void {
    const capture = this.terminalCommands.complete(
      event.execution,
      event.execution.commandLine,
      this.relativeTerminalCwd(event.execution.cwd),
      event.exitCode,
      new Date().toISOString(),
      this.maxTerminalCommandBytes(),
    );
    if (!capture || !this.terminalCaptureEnabled()) return;
    this.emit('terminal_command', undefined, capture.payload, capture);
  }
  private captureLimits(): CodeCaptureLimits {
    const config = vscode.workspace.getConfiguration('aiWorklog.eventCapture');
    const fileSize = Number(config.get<number>('maxFileSizeBytes', DEFAULT_MAX_FILE_SIZE_BYTES));
    const diffSize = Number(config.get<number>('maxDiffBytes', DEFAULT_MAX_DIFF_BYTES));
    const exclude = config.get<string[]>('exclude', []);
    return {
      maxFileSizeBytes: Number.isFinite(fileSize) ? Math.max(1_024, Math.min(fileSize, 10 * 1024 * 1024)) : DEFAULT_MAX_FILE_SIZE_BYTES,
      maxDiffBytes: Number.isFinite(diffSize) ? Math.max(1_024, Math.min(diffSize, 245_000)) : DEFAULT_MAX_DIFF_BYTES,
      exclude: Array.isArray(exclude) ? exclude.filter(item => typeof item === 'string') : [],
    };
  }
  private isEligible(document: vscode.TextDocument): boolean {
    const file = relativeFilePath(document.uri);
    return Boolean(file.filePath && captureEligibility(file.filePath, document.getText(), this.captureLimits()).eligible);
  }
  private primeBaseline(document: vscode.TextDocument): void {
    if (!this.captureGate.accepting) return;
    if (this.isEligible(document)) this.savedBaselines.prime(document.uri.toString(), document.getText());
    else this.savedBaselines.delete(document.uri.toString());
  }
  private captureSavedDocument(document: vscode.TextDocument): void {
    if (!this.captureGate.accepting) return;
    const file = relativeFilePath(document.uri);
    const current = document.getText();
    const limits = this.captureLimits();
    const eligibility = file.filePath ? captureEligibility(file.filePath, current, limits) : { eligible: false as const, reason: 'outside_workspace' };
    if (!eligibility.eligible) {
      this.savedBaselines.delete(document.uri.toString());
      if (this.captureGate.accepting && file.filePath) this.log(`code diff skipped for ${file.filePath}: ${eligibility.reason}`);
      return;
    }
    const capture = this.savedBaselines.capture(document.uri.toString(), current, file.filePath!, limits.maxDiffBytes);
    const diff = capture.kind === 'diff' ? capture.diff : undefined;
    this.emit('file_saved', document.uri, {
      language_id: document.languageId,
      file_size: Buffer.byteLength(current, 'utf8'),
      added_lines: diff?.addedLines ?? 0,
      removed_lines: diff?.removedLines ?? 0,
      diff_summary: capture.kind === 'baseline' ? 'diff unavailable: no saved baseline' : `${diff?.addedLines ?? 0} lines added, ${diff?.removedLines ?? 0} lines removed`,
      diff_truncated: diff?.patchTruncated ?? false,
    });
    if (!diff) return;
    this.emit('code_diff', document.uri, {
      language_id: document.languageId,
      file_size: Buffer.byteLength(current, 'utf8'),
      patch: diff.patch,
      changed_ranges: [{ before_start_line: diff.beforeStartLine, before_line_count: diff.beforeLineCount, after_start_line: diff.afterStartLine, after_line_count: diff.afterLineCount }],
      added_lines: diff.addedLines,
      removed_lines: diff.removedLines,
      original_patch_bytes: diff.originalPatchBytes,
      retained_patch_bytes: diff.retainedPatchBytes,
      patch_truncated: diff.patchTruncated,
      capture_mode: 'save-time-snapshot',
    });
  }
  private emit(type: WorklogEventType, uri: vscode.Uri | undefined, payload: Record<string, unknown>, ownership?: TerminalCommandOwnership): void {
    const task = this.state.task;
    if (!this.captureGate.accepting || !task || task.status !== 'active') return;
    if (ownership && ownership.taskId !== task.id) return;
    const file = uri ? relativeFilePath(uri) : {};
    if (uri && !file.filePath) return;

    // Snapshot now.  Do not evaluate currentBugId from EventBuffer.flush().
    const bugId = ownership ? ownership.bugId : this.currentBugId();
    const event: BufferedEvent = {
      client_event_id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      event_type: type,
      source: 'vscode',
      taskId: ownership?.taskId || task.id,
      ...(bugId ? { bug_id: bugId } : {}),
      occurred_at: new Date().toISOString(),
      ...file,
      payload: safePayload(payload),
    };
    this.buffer.add(event);
  }
  async flush(): Promise<void> { await this.buffer.flush(); }
  async flushAll(): Promise<void> { await this.buffer.flushAll(); }
  get pendingCount(): number { return this.buffer.size; }
  setEnabled(value: boolean): void {
    const wasAccepting = this.captureGate.accepting;
    this.captureGate.setEnabled(value);
    if (this.captureGate.accepting && !wasAccepting) vscode.workspace.textDocuments.forEach(document => this.primeBaseline(document));
    if (!value) { this.buffer.clear(); this.savedBaselines.clear(); this.terminalCommands.clear(); }
  }
  // Pausing blocks new captures without destroying ownership snapshots. If a
  // Task-end request fails and the Task is still active, a still-running
  // command can therefore complete normally after capture resumes. A
  // successful Task end calls setEnabled(false), which clears the tracker.
  pauseCapture(): void { this.captureGate.pause(); }
  resumeCapture(): void {
    const wasAccepting = this.captureGate.accepting;
    this.captureGate.resume();
    if (this.captureGate.accepting && !wasAccepting) vscode.workspace.textDocuments.forEach(document => this.primeBaseline(document));
  }
  record(type: WorklogEventType, payload: Record<string, unknown> = {}): void { this.emit(type, undefined, payload); }
  dispose(): void { this.captureGate.pause(); this.subscriptions.forEach(s => s.dispose()); this.savedBaselines.clear(); this.terminalCommands.clear(); void this.buffer.dispose(); }
}
