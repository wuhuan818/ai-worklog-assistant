import assert from 'node:assert/strict';
import test from 'node:test';
import { BugState } from './bugState';
import { BugRecord } from './types';

const bug = (id: string, status: BugRecord['status'] = 'open'): BugRecord => ({ id, userId: 'u', projectId: 'p', taskId: 't', title: id, severity: 'high', tags: [], status, createdAt: '', updatedAt: '', activatedAt: status === 'active' ? new Date(0).toISOString() : null, totalActiveSeconds: 4 });

test('BugState restores current bug, counts statuses, and clears on task switch', () => {
  const state = new BugState(); state.restore('t', [bug('a', 'active'), bug('b', 'paused'), bug('c', 'resolved')], bug('a', 'active'));
  assert.equal(state.activeBugId, 'a'); assert.deepEqual(state.counts(), { open: 0, active: 1, paused: 1, resolved: 1 }); assert.equal(state.elapsedSeconds(5000), 9);
  state.forTask('other'); assert.equal(state.current, undefined); assert.equal(state.all.length, 0);
});

test('BugState clears active selection when its server record changes', () => {
  const state = new BugState(); state.restore('t', [bug('a', 'active')], bug('a', 'active')); state.replace(bug('a', 'resolved')); assert.equal(state.activeBugId, undefined);
});
