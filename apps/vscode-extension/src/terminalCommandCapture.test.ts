import assert from 'node:assert/strict';
import test from 'node:test';
import { sanitizeTerminalCwd, TerminalCommandTracker } from './eventCapture/terminalCommand';

const startedAt = '2026-08-09T00:00:00.000Z';
const endedAt = '2026-08-09T00:00:01.250Z';

test('terminal command completion preserves start-time ownership and exit status', () => {
  const tracker = new TerminalCommandTracker();
  const execution = {};
  tracker.begin(execution, { taskId: 'task-a', bugId: 'bug-a', startedAt, cwd: 'src' });
  const capture = tracker.complete(execution, { value: 'npm.cmd test', confidence: 2, isTrusted: true }, undefined, 1, endedAt, 4096);
  assert.equal(capture?.taskId, 'task-a');
  assert.equal(capture?.bugId, 'bug-a');
  assert.deepEqual(capture?.payload, {
    command: 'npm.cmd test', confidence: 'high', is_trusted: true, cwd: 'src', status: 'failed', exit_code: 1,
    started_at: startedAt, duration_ms: 1250, original_command_bytes: 12, retained_command_bytes: 12,
    command_truncated: false, capture_mode: 'shell-integration', output_captured: false,
  });
  assert.equal(tracker.size, 0);
});

test('unknown exit codes remain explicit and low-confidence or empty commands are omitted', () => {
  const tracker = new TerminalCommandTracker();
  const unknown = {};
  tracker.begin(unknown, { taskId: 'task', startedAt });
  const upgraded = tracker.complete(unknown, { value: 'git status', confidence: 1, isTrusted: false }, undefined, undefined, endedAt, 4096);
  assert.equal(upgraded?.payload.status, 'unknown');
  assert.equal(upgraded?.payload.exit_code, null);
  assert.equal(upgraded?.payload.confidence, 'medium');

  for (const commandLine of [{ value: 'prompt artifact', confidence: 0, isTrusted: false }, { value: ' \r\n\t ', confidence: 2, isTrusted: true }]) {
    const key = {};
    tracker.begin(key, { taskId: 'task', startedAt });
    assert.equal(tracker.complete(key, commandLine, undefined, 0, endedAt, 4096), undefined);
  }
});

test('terminal commands are normalized and UTF-8 bounded without output fields', () => {
  const tracker = new TerminalCommandTracker();
  const execution = {};
  const raw = `node -e "${'界'.repeat(100)}"\n\u0000`;
  tracker.begin(execution, { taskId: 'task', startedAt });
  const capture = tracker.complete(execution, { value: raw, confidence: 2, isTrusted: false }, undefined, 0, endedAt, 96);
  assert.ok(capture?.payload.command.endsWith('<command-truncated>'));
  assert.ok(Buffer.byteLength(capture?.payload.command || '', 'utf8') <= 96);
  assert.equal(capture?.payload.command.includes('\n'), false);
  assert.equal(capture?.payload.command_truncated, true);
  assert.equal(capture?.payload.output_captured, false);
  assert.equal(Object.hasOwn(capture?.payload || {}, 'output'), false);
});

test('terminal command normalization preserves emoji and replaces lone surrogates', () => {
  const tracker = new TerminalCommandTracker();
  const execution = {};
  const raw = 'echo 😀\u2028whoami\u009b31m\ud800';
  tracker.begin(execution, { taskId: 'task', startedAt });
  const capture = tracker.complete(execution, { value: raw, confidence: 2, isTrusted: false }, undefined, 0, endedAt, 4096);
  assert.equal(capture?.payload.command.includes('😀'), true);
  assert.equal(capture?.payload.command.includes('\uFFFD'), true);
  assert.equal(capture?.payload.command.includes('\u2028'), false);
  assert.equal(capture?.payload.command.includes('\u009b'), false);
  assert.equal(capture?.payload.command.includes('\ud800'), false);
  assert.doesNotThrow(() => Buffer.from(capture?.payload.command || '', 'utf8'));
});

test('terminal cwd omits control separators and unpaired surrogates without losing valid emoji', () => {
  assert.equal(sanitizeTerminalCwd('src/😀'), 'src/😀');
  assert.equal(sanitizeTerminalCwd('cafe\u0301'), 'caf\u00E9');
  for (const value of ['src/\u0001bad', 'src/\u007fbad', 'src/\u0085bad', 'src/\u2028bad', 'src/\u2029bad', 'src/\ud800bad', 'src/bad\ud800', 'src/\udc00bad']) {
    assert.equal(sanitizeTerminalCwd(value), undefined);
  }

  const tracker = new TerminalCommandTracker();
  const execution = {};
  const omittedCwd = sanitizeTerminalCwd('src/\u2028bad');
  tracker.begin(execution, { taskId: 'task', startedAt, cwd: omittedCwd });
  const capture = tracker.complete(execution, { value: 'git status', confidence: 2, isTrusted: true }, omittedCwd, 0, endedAt, 4096);
  assert.ok(capture);
  assert.equal(Object.hasOwn(capture.payload, 'cwd'), false);
});

test('clearing a Task boundary discards commands without a real end event', () => {
  const tracker = new TerminalCommandTracker();
  tracker.begin({}, { taskId: 'task-a', startedAt });
  tracker.begin({}, { taskId: 'task-a', startedAt });
  assert.equal(tracker.size, 2);
  tracker.clear();
  assert.equal(tracker.size, 0);
});
