export const DEFAULT_MAX_TERMINAL_COMMAND_BYTES = 4_096;
export const HARD_MAX_TERMINAL_COMMAND_BYTES = 8_192;

export interface TerminalCommandLineSnapshot {
  value: string;
  confidence: number;
  isTrusted: boolean;
}

export interface TerminalCommandOwnership {
  taskId: string;
  bugId?: string;
}

interface PendingTerminalCommand extends TerminalCommandOwnership {
  cwd?: string;
  startedAt: string;
}

export interface TerminalCommandPayload extends Record<string, unknown> {
  command: string;
  confidence: 'medium' | 'high';
  is_trusted: boolean;
  cwd?: string;
  status: 'succeeded' | 'failed' | 'unknown';
  exit_code: number | null;
  started_at: string;
  duration_ms: number;
  original_command_bytes: number;
  retained_command_bytes: number;
  command_truncated: boolean;
  capture_mode: 'shell-integration';
  output_captured: false;
}

function hasUnpairedSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code >= 0xD800 && code <= 0xDBFF) {
      const next = value.charCodeAt(index + 1);
      if (index + 1 >= value.length || next < 0xDC00 || next > 0xDFFF) return true;
      index++;
    } else if (code >= 0xDC00 && code <= 0xDFFF) {
      return true;
    }
  }
  return false;
}

function hasForbiddenCwdCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0)!;
    if (code <= 0x1F || (code >= 0x7F && code <= 0x9F) || code === 0x2028 || code === 0x2029) return true;
  }
  return false;
}

function stripCommandControls(value: string): string {
  let result = '';
  for (const character of value) {
    const code = character.codePointAt(0)!;
    if (code <= 0x08 || code === 0x0B || code === 0x0C || (code >= 0x0E && code <= 0x1F) || (code >= 0x7F && code <= 0x9F)) continue;
    result += character;
  }
  return result;
}

/**
 * A malformed cwd is optional metadata, so omit it instead of allowing one
 * path to make the whole terminal event permanently unflushable.
 */
export function sanitizeTerminalCwd(value: string): string | undefined {
  if (!value || hasUnpairedSurrogate(value) || hasForbiddenCwdCharacter(value)) return undefined;
  const normalized = value.normalize('NFC');
  if (!normalized || normalized !== normalized.trim()) return undefined;
  return normalized;
}

export interface CapturedTerminalCommand extends TerminalCommandOwnership {
  payload: TerminalCommandPayload;
}

function utf8Prefix(value: string, byteLimit: number): string {
  if (byteLimit <= 0 || !value) return '';
  if (Buffer.byteLength(value, 'utf8') <= byteLimit) return value;
  let low = 0;
  let high = value.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (Buffer.byteLength(value.slice(0, middle), 'utf8') <= byteLimit) low = middle;
    else high = middle - 1;
  }
  // Do not persist a dangling UTF-16 high surrogate when the boundary falls
  // between the two code units of a non-BMP character.
  const prefix = value.slice(0, low);
  return /[\uD800-\uDBFF]$/.test(prefix) ? prefix.slice(0, -1) : prefix;
}

function normalizeCommand(value: string): string {
  const normalized = stripCommandControls(value
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/[\u0085\u2028\u2029]+/g, ' '))
    .trim()
    .normalize('NFC');
  // Buffer's codec preserves valid pairs and replaces only unpaired UTF-16
  // surrogates, keeping the backend JSON/UTF-8 contract total.
  return Buffer.from(normalized, 'utf8').toString('utf8');
}

interface BoundedCommand { command: string; originalBytes: number; retainedBytes: number; truncated: boolean }

function boundedCommand(value: string, maxBytes: number): BoundedCommand | undefined {
  const normalized = normalizeCommand(value);
  if (!normalized) return undefined;
  const limit = Math.max(32, Math.min(Math.floor(maxBytes), HARD_MAX_TERMINAL_COMMAND_BYTES));
  const originalBytes = Buffer.byteLength(normalized, 'utf8');
  if (originalBytes <= limit) return { command: normalized, originalBytes, retainedBytes: originalBytes, truncated: false };
  const marker = ' <command-truncated>';
  const markerBytes = Buffer.byteLength(marker, 'utf8');
  const prefix = utf8Prefix(normalized, Math.max(0, limit - markerBytes)).trimEnd();
  const command = prefix ? `${prefix}${marker}` : utf8Prefix(marker.trimStart(), limit);
  return { command, originalBytes, retainedBytes: Buffer.byteLength(command, 'utf8'), truncated: true };
}

function confidenceLabel(value: number): 'medium' | 'high' | undefined {
  if (value === 1) return 'medium';
  if (value === 2) return 'high';
  return undefined;
}

function durationMs(startedAt: string, endedAt: string): number {
  const difference = Date.parse(endedAt) - Date.parse(startedAt);
  return Number.isFinite(difference) ? Math.max(0, Math.floor(difference)) : 0;
}

/**
 * Tracks only command metadata. Terminal output is deliberately never read.
 * Task and Bug ownership are snapshotted when the command starts so a later
 * Bug switch cannot re-parent the completed event.
 */
export class TerminalCommandTracker {
  private readonly pending = new Map<object, PendingTerminalCommand>();

  get size(): number { return this.pending.size; }

  begin(key: object, input: PendingTerminalCommand): void { this.pending.set(key, input); }

  complete(
    key: object,
    commandLine: TerminalCommandLineSnapshot,
    cwd: string | undefined,
    exitCode: number | undefined,
    endedAt: string,
    maxBytes: number,
  ): CapturedTerminalCommand | undefined {
    const pending = this.pending.get(key);
    this.pending.delete(key);
    if (!pending) return undefined;
    return this.capture(pending, commandLine, cwd ?? pending.cwd, exitCode, endedAt, maxBytes);
  }

  clear(): void { this.pending.clear(); }

  private capture(
    pending: PendingTerminalCommand,
    commandLine: TerminalCommandLineSnapshot,
    cwd: string | undefined,
    exitCode: number | undefined,
    endedAt: string,
    maxBytes: number,
  ): CapturedTerminalCommand | undefined {
    const confidence = confidenceLabel(commandLine.confidence);
    const bounded = boundedCommand(commandLine.value, maxBytes);
    if (!confidence || !bounded) return undefined;
    const status = exitCode === undefined ? 'unknown' : exitCode === 0 ? 'succeeded' : 'failed';
    return {
      taskId: pending.taskId,
      ...(pending.bugId ? { bugId: pending.bugId } : {}),
      payload: {
        command: bounded.command,
        confidence,
        is_trusted: commandLine.isTrusted,
        ...(cwd ? { cwd } : {}),
        status,
        exit_code: exitCode ?? null,
        started_at: pending.startedAt,
        duration_ms: durationMs(pending.startedAt, endedAt),
        original_command_bytes: bounded.originalBytes,
        retained_command_bytes: bounded.retainedBytes,
        command_truncated: bounded.truncated,
        capture_mode: 'shell-integration',
        output_captured: false,
      },
    };
  }
}
