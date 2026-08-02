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
