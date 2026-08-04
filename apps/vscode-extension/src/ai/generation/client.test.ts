import assert from 'node:assert/strict';
import test from 'node:test';
import { GenerationClient } from './client';

test('GenerationClient polls until a terminal status', async () => {
  let reads = 0;
  const api = { getAiGenerationJob: async () => ({ context_id: 'ctx', status: ++reads === 1 ? 'running' : 'succeeded' }), createAiSummaryGeneration: async () => ({ context_id: 'ctx', status: 'queued', job_id: 'job' }), cancelAiGenerationJob: async () => ({ context_id: 'ctx', status: 'cancelled' }), listAiSummaryDrafts: async () => [], getAiSummaryDraft: async () => ({}) } as never;
  const client = new GenerationClient(api, 1);
  const updates: string[] = [];
  const result = await client.wait('job', job => updates.push(job.status));
  assert.equal(result.status, 'succeeded');
  assert.deepEqual(updates, ['running', 'succeeded']);
});

test('GenerationClient delegates creation and cancellation without exposing profile state', async () => {
  const calls: string[] = [];
  const api = { createAiSummaryGeneration: async () => { calls.push('create'); return { context_id: 'ctx', status: 'queued', job_id: 'job' }; }, cancelAiGenerationJob: async () => { calls.push('cancel'); return { context_id: 'ctx', status: 'cancelled' }; }, getAiGenerationJob: async () => ({ context_id: 'ctx', status: 'succeeded' }), listAiSummaryDrafts: async () => [], getAiSummaryDraft: async () => ({}) } as never;
  const client = new GenerationClient(api, 1);
  await client.create('ctx', { profile_id: 'p', provider: 'deepseek', base_url: 'https://example.test', model: 'm', thinking_enabled: false, timeout_seconds: 5, max_output_tokens: 100, api_key: 'synthetic-secret' }, 'key');
  await client.cancel('job');
  assert.deepEqual(calls, ['create', 'cancel']);
});

test('GenerationClient gives polling a bounded timeout', async () => {
  const api = { getAiGenerationJob: async () => ({ context_id: 'ctx', status: 'running' }), createAiSummaryGeneration: async () => ({ context_id: 'ctx', status: 'queued', job_id: 'job' }), cancelAiGenerationJob: async () => ({ context_id: 'ctx', status: 'cancelled' }), listAiSummaryDrafts: async () => [], getAiSummaryDraft: async () => ({}) } as never;
  await assert.rejects(new GenerationClient(api, 1, 5).wait('job'), /timed out/);
});
