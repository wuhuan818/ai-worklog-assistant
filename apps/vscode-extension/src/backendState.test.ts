import assert from 'node:assert/strict';
import test from 'node:test';
import { backendStateLabel, BackendState } from './backendState';

test('backend state labels cover the lifecycle state machine', () => {
  assert.deepEqual(['stopped', 'starting', 'healthy', 'error', 'stopping'].map(value => backendStateLabel(value as BackendState)), ['已停止', '启动中', '正常', '异常', '停止中']);
});
