import assert from 'node:assert/strict';
import test from 'node:test';
import { buttonState, SnapshotDeduper, WorklogViewSnapshot } from './viewSnapshot';

function snapshot(): WorklogViewSnapshot { return { backendState: 'healthy', backendLabel: '正常', error: '无', task: { name: 'Task', project: 'Project', started: '-', status: '进行中', active: true }, bug: { title: 'Bug A', status: 'active', severity: 'high', active: true, total: 1, unresolved: 1 }, events: { total: 0, latest: '-', latestTime: '-', pending: 0 }, buttons: buttonState('healthy', true, true) }; }
test('identical business snapshots are deduplicated while timer updates remain independent', () => { const deduper = new SnapshotDeduper(); const state = snapshot(); assert.equal(deduper.shouldSend(state), true); for (let index = 0; index < 10; index++) assert.equal(deduper.shouldSend(state), false); });
test('a real bug lifecycle change emits one new button snapshot', () => { const deduper = new SnapshotDeduper(); const state = snapshot(); assert.equal(deduper.shouldSend(state), true); state.bug.status = 'paused'; state.bug.active = false; state.buttons = buttonState('healthy', true, false); assert.equal(deduper.shouldSend(state), true); assert.equal(state.buttons.pauseBug, false); assert.equal(deduper.shouldSend(state), false); });
test('button matrix has one authority for healthy task states', () => { assert.equal(buttonState('healthy', true, true).pauseBug, true); assert.equal(buttonState('healthy', true, false).pauseBug, false); assert.equal(buttonState('starting', true, true).createBug, false); });
