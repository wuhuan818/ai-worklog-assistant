import assert from 'node:assert/strict';
import test from 'node:test';
import { BugService } from './bugService';

test('BugService maps requests to the stage 5 API contract', async () => {
  const calls: Array<{ path: string; init?: RequestInit }> = []; const client = { request: async <T>(path: string, init?: RequestInit) => { calls.push({ path, init }); return ({ bug: null } as T); } };
  const service = new BugService(client);
  await service.create('t /', { title: 'A', severity: 'high', externalReference: 'REF' }); await service.current('t'); await service.resolve('t', 'b', { resolutionSummary: 'fixed' }); await service.addNote('t', 'b', { clientNoteId: 'n', text: 'private note' });
  assert.equal(calls[0].path, '/tasks/t%20%2F/bugs'); assert.deepEqual(JSON.parse(calls[0].init?.body as string), { title: 'A', severity: 'high', description: undefined, category: undefined, source: undefined, external_reference: 'REF', tags: undefined, activate_immediately: undefined });
  assert.equal(calls[1].path, '/tasks/t/bugs/current'); assert.equal(calls[2].path, '/tasks/t/bugs/b/resolve'); assert.equal(calls[3].path, '/tasks/t/bugs/b/notes');
});

test('BugService rejects malformed empty-current responses', async () => {
  const service = new BugService({ request: async <T>() => ({}) as T });
  await assert.rejects(() => service.current('t'), /响应格式/);
});
