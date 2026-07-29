import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

test('declared sidebar view is a webview with a registered provider in the compiled extension', () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')) as { contributes: { views: Record<string, Array<{ id: string; type?: string }>> }; activationEvents: string[]; main: string };
  const view = packageJson.contributes.views.aiWorklog.find(item => item.id === 'aiWorklog.sidebar');
  assert.equal(view?.type, 'webview');
  assert.ok(packageJson.activationEvents.includes('onView:aiWorklog.sidebar'));
  assert.equal(packageJson.main, './dist/extension.js');
  const compiled = fs.readFileSync(path.join(__dirname, 'extension.js'), 'utf8');
  assert.match(compiled, /registerWebviewViewProvider/);
  assert.match(compiled, /aiWorklog\.sidebar/);
  assert.match(compiled, /后端状态/);
  assert.match(compiled, /添加备注/);
});
