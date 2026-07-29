import assert from 'node:assert/strict';
import test from 'node:test';
import { TaskState } from './taskState';

test('TaskState transforms missing tags and tracks recording status', () => {
  const state = new TaskState();
  assert.equal(state.isRecording(), false);
  state.setTask({ id: '1', project_id: 'p', name: 'Demo', status: 'active', started_at: 'now', tags: undefined as unknown as string[] });
  assert.equal(state.isRecording(), true);
  assert.deepEqual(state.task?.tags, []);
  assert.equal(state.label(), 'Demo (active)');
  state.clear();
  assert.equal(state.label(), '暂无活动任务');
});
