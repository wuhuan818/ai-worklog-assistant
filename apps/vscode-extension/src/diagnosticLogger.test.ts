import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { DiagnosticLogger } from './diagnosticLogger';

test('diagnostic logger writes to the shared output adapter and persistent file', () => {
  const output: { lines: string[]; shown: boolean } = { lines: [], shown: false };
  const filePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ai-worklog-log-')), 'ai-worklog.log');
  const logger = new DiagnosticLogger({ appendLine: line => output.lines.push(line), show: () => { output.shown = true; } }, filePath);
  logger.appendLine('[activation] AI Worklog extension activated');
  assert.match(output.lines[0], /AI Worklog extension activated/);
  assert.match(fs.readFileSync(filePath, 'utf8'), /AI Worklog extension activated/);
});
