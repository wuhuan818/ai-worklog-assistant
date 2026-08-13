import assert from 'node:assert/strict';
import test from 'node:test';
import { BufferedEvent, EventBuffer } from './eventBuffer';

function event(id: string, bugId?: string): BufferedEvent {
  return {
    client_event_id: id,
    event_type: 'file_changed',
    source: 'vscode',
    taskId: 'task-1',
    ...(bugId ? { bug_id: bugId } : {}),
  };
}

test('EventBuffer preserves each event bug association through a later switch', async () => {
  const sent: BufferedEvent[][] = [];
  const buffer = new EventBuffer(async (_taskId, events) => { sent.push(events); }, 500, 50, 60_000);

  buffer.add(event('event-a', 'bug-a'));
  buffer.add(event('event-b', 'bug-b'));
  await buffer.flush();

  assert.deepEqual(sent[0].map(item => item.bug_id), ['bug-a', 'bug-b']);
  await buffer.dispose();
});

test('EventBuffer keeps task-only events unassociated', async () => {
  const sent: BufferedEvent[][] = [];
  const buffer = new EventBuffer(async (_taskId, events) => { sent.push(events); }, 500, 50, 60_000);

  buffer.add(event('event-without-bug'));
  await buffer.flush();

  assert.equal(sent[0][0].bug_id, undefined);
  await buffer.dispose();
});

test('EventBuffer flushAll drains more than one HTTP batch', async () => {
  const sent: BufferedEvent[] = [];
  const buffer = new EventBuffer(async (_taskId, events) => { sent.push(...events); }, 500, 501, 60_000);
  for (let index = 0; index < 205; index += 1) buffer.add(event(`event-${index}`));
  await buffer.flushAll();
  assert.equal(sent.length, 205);
  assert.equal(buffer.size, 0);
  await buffer.dispose();
});

test('EventBuffer flushAll waits for an in-flight flush and drains later arrivals', async () => {
  const sent: BufferedEvent[] = [];
  let release!: () => void;
  const firstSend = new Promise<void>(resolve => { release = resolve; });
  let calls = 0;
  const buffer = new EventBuffer(async (_taskId, events) => { calls += 1; if (calls === 1) await firstSend; sent.push(...events); }, 500, 1, 60_000);
  buffer.add(event('event-a'));
  buffer.add(event('event-b'));
  const draining = buffer.flushAll();
  release();
  await draining;
  assert.deepEqual(sent.map(item => item.client_event_id), ['event-a', 'event-b']);
  assert.equal(buffer.size, 0);
  await buffer.dispose();
});

test('EventBuffer flushAll requeues and exposes a send failure for retry', async () => {
  let fail = true;
  const sent: BufferedEvent[] = [];
  const buffer = new EventBuffer(async (_taskId, events) => { if (fail) throw new Error('offline'); sent.push(...events); }, 500, 501, 60_000);
  buffer.add(event('event-retry'));
  await assert.rejects(() => buffer.flushAll(), /offline/);
  assert.equal(buffer.size, 1);
  fail = false;
  await buffer.flushAll();
  assert.equal(buffer.size, 0);
  assert.equal(sent[0].client_event_id, 'event-retry');
  await buffer.dispose();
});

test('a best-effort flush never inherits an authoritative drain rejection', async () => {
  let rejectFirst!: (error: Error) => void;
  let calls = 0;
  const firstSend = new Promise<void>((_resolve, reject) => { rejectFirst = reject; });
  const buffer = new EventBuffer(async () => { calls += 1; if (calls === 1) await firstSend; }, 500, 501, 60_000);
  buffer.add(event('event-race'));
  const authoritative = buffer.flushAll();
  const bestEffort = buffer.flush();
  rejectFirst(new Error('offline'));
  await assert.rejects(authoritative, /offline/);
  await assert.doesNotReject(bestEffort);
  assert.equal(buffer.size, 1);
  await buffer.flushAll();
  await buffer.dispose();
});
