import assert from 'node:assert/strict';
import test from 'node:test';
import { BugState } from './bugState';
import { bugViewModel } from './bugViewModel';
import { BugRecord } from './types';

const active: BugRecord = { id: 'b', userId: 'u', projectId: 'p', taskId: 't', title: 'B', severity: 'high', tags: [], status: 'active', createdAt: '', updatedAt: '', activatedAt: new Date().toISOString(), totalActiveSeconds: 0 };
test('view model exposes correct healthy task button matrix', () => {
  const state = new BugState(); let model = bugViewModel('healthy', true, state); assert.equal(model.buttons.create, true); assert.equal(model.buttons.pause, false); assert.equal(model.buttons.addNote, false);
  state.restore('t', [active], active); model = bugViewModel('healthy', true, state); assert.equal(model.buttons.pause, true); assert.equal(model.buttons.resolve, true); assert.equal(model.buttons.addNote, true);
  assert.equal(bugViewModel('starting', true, state).buttons.create, false); assert.equal(bugViewModel('healthy', false, state).buttons.pause, false);
});
