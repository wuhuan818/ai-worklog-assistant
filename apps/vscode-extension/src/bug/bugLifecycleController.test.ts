import assert from 'node:assert/strict';
import test from 'node:test';
import { BugLifecycleController } from './bugLifecycleController';
import { BugState } from './bugState';
import { BugRecord } from './types';

const record = (id: string, status: BugRecord['status']): BugRecord => ({ id, userId: 'u', projectId: 'p', taskId: 't', title: id, severity: 'medium', tags: [], status, createdAt: '', updatedAt: '', activatedAt: null, totalActiveSeconds: 0 });

test('controller atomically reflects activated target and paused old bug', async () => {
  const state = new BugState(); const service = { activate: async () => ({ activeBug: record('b', 'active'), pausedBug: record('a', 'paused') }) } as never;
  const controller = new BugLifecycleController(state, service, () => undefined, () => undefined);
  await controller.activate('t', 'b'); assert.equal(state.activeBugId, 'b'); assert.equal(state.all.find(bug => bug.id === 'a')?.status, 'paused');
});

test('controller validates local input and prevents repeated submissions', async () => {
  let release!: () => void; const state = new BugState(); const service = { create: async () => await new Promise<BugRecord>(resolve => { release = () => resolve(record('b', 'open')); }) } as never;
  const controller = new BugLifecycleController(state, service, () => undefined, () => undefined);
  await assert.rejects(() => controller.create('t', { title: ' ', severity: 'low' }), /标题/);
  const first = controller.create('t', { title: 'B', severity: 'low' }); await assert.rejects(() => controller.create('t', { title: 'C', severity: 'low' }), /正在进行/); release(); await first;
});
