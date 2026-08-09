import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

test('event capture registers every VS Code source and sidebar controls', () => {
  const compiled = fs.readFileSync(path.join(__dirname, 'eventCapture', 'eventCaptureController.js'), 'utf8');
  assert.match(compiled, /onDidSaveTextDocument/);
  assert.match(compiled, /onDidOpenTextDocument/);
  assert.match(compiled, /onDidCloseTextDocument/);
  assert.match(compiled, /SaveDiffTracker/);
  assert.match(compiled, /captureSavedDocument/);
  assert.match(compiled, /code_diff/);
  assert.match(compiled, /onDidChangeTextDocument/);
  assert.match(compiled, /onDidChangeDiagnostics/);
  assert.match(compiled, /onDidStartTask/);
  assert.match(compiled, /onDidEndTask/);
  assert.match(compiled, /onDidStartDebugSession/);
  assert.match(compiled, /onDidTerminateDebugSession/);
  assert.match(compiled, /onDidChangeActiveDebugSession/);
  const extension = fs.readFileSync(path.join(__dirname, 'extension.js'), 'utf8');
  assert.match(extension, /showRecentEvents/);
  assert.match(extension, /refreshEvents/);
  assert.match(extension, /已记录事件/);
});
