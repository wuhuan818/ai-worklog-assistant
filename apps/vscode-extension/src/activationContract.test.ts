import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

test('activation creates the shared AI Worklog output channel and show-logs command', () => {
  const compiled = fs.readFileSync(path.join(__dirname, 'extension.js'), 'utf8');
  assert.match(compiled, /createOutputChannel\([^)]*OUTPUT_CHANNEL_NAME/);
  assert.match(compiled, /AI Worklog extension activated/);
  assert.match(compiled, /output\.show\(true\)/);
  const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')) as { contributes: { commands: Array<{ command: string; title: string }> } };
  assert.deepEqual(packageJson.contributes.commands.find(command => command.command === 'aiWorklog.showLogs')?.title, 'AI Worklog: Show Logs');
});
