import test from 'node:test';
import assert from 'node:assert/strict';
import { buttonState, shouldApplyRender } from './viewState';

test('view render version rejects an older async render', () => {
  assert.equal(shouldApplyRender(11, 12), false);
  assert.equal(shouldApplyRender(12, 12), true);
});

test('healthy active task enables task and event actions', () => {
  assert.deepEqual(buttonState('healthy', true, 3), { startServer: true, restartServer: true, startTask: false, endTask: true, addNote: true, refresh: true, refreshEvents: true, showRecentEvents: true });
});

test('button matrix keeps non-healthy views from acting on tasks', () => {
  for (const state of ['starting', 'stopped', 'error'] as const) {
    const buttons = buttonState(state, true, 3);
    assert.equal(buttons.startTask, false);
    assert.equal(buttons.endTask, false);
    assert.equal(buttons.addNote, false);
    assert.equal(buttons.refreshEvents, false);
  }
});
