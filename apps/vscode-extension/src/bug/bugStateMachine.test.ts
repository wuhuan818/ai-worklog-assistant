import assert from 'node:assert/strict';
import test from 'node:test';
import { assertBugTransition, canTransitionBug } from './bugStateMachine';

test('Bug state machine accepts the lifecycle and rejects invalid transitions', () => {
  assert.equal(canTransitionBug('open', 'active'), true); assert.equal(canTransitionBug('active', 'paused'), true); assert.equal(canTransitionBug('paused', 'active'), true); assert.equal(canTransitionBug('active', 'resolved'), true); assert.equal(canTransitionBug('resolved', 'open'), true);
  assert.equal(canTransitionBug('resolved', 'active'), false); assert.throws(() => assertBugTransition('active', 'active'));
});
