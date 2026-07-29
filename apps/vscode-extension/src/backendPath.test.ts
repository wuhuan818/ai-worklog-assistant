import assert from 'node:assert/strict';
import test from 'node:test';
import * as path from 'node:path';
import { resolveBackendExecutable } from './backendPath';

test('backend path resolves from workspace artifacts', () => {
  const root = path.join('C:', 'workspace with spaces');
  const expected = path.join(root, 'artifacts', 'backend', 'ai-worklog-server.exe');
  assert.equal(resolveBackendExecutable({ extensionPath: path.join(root, 'apps', 'vscode-extension'), workspaceRoot: root, exists: candidate => candidate === expected }), path.resolve(expected));
});

test('backend path reports checked candidates when executable is missing', () => {
  assert.throws(() => resolveBackendExecutable({ extensionPath: path.join('C:', 'workspace', 'extension'), workspaceRoot: path.join('C:', 'workspace'), exists: () => false }), /未找到本地后端可执行程序/);
});
