import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiClient, ApiError, HttpTransport } from './apiClient';

test('ApiClient adds bearer token and converts health response', async () => {
  let captured: RequestInit | undefined;
  const transport: HttpTransport = { fetch: async (_input, init) => {
    captured = init;
    return new Response(JSON.stringify({ status: 'ok', service: 'local-server' }), { status: 200 });
  } };
  const health = await new ApiClient('http://127.0.0.1:8765', 'token-123', transport).health();
  assert.deepEqual(health, { status: 'ok', service: 'local-server' });
  assert.equal((captured?.headers as Record<string, string>).authorization, 'Bearer token-123');
});

test('ApiClient reports HTTP and transport failures', async () => {
  const denied: HttpTransport = { fetch: async () => new Response('denied', { status: 401 }) };
  await assert.rejects(() => new ApiClient('http://localhost', 'bad', denied).health(), (error: ApiError) => error.status === 401 && error.message === 'denied');
  const offline: HttpTransport = { fetch: async () => { throw new Error('offline'); } };
  await assert.rejects(() => new ApiClient('http://localhost', 'bad', offline).health(), (error: ApiError) => error.status === 0 && error.message.includes('后端不可用'));
});

test('ApiClient bounds a wedged loopback request and aborts its transport', async () => {
  let aborted = false;
  const wedged: HttpTransport = { fetch: async (_input, init) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => { aborted = true; reject(new Error('aborted')); }, { once: true });
  }) };
  const client = new ApiClient('http://127.0.0.1', 'token', wedged);
  await assert.rejects(() => client.request('/never', {}, 20), (error: ApiError) => error.category === 'transport' && error.message.includes('请求超时'));
  assert.equal(aborted, true);
});

test('ApiClient timeout also bounds a response body that never finishes', async () => {
  const partialBody: HttpTransport = { fetch: async () => new Response(new ReadableStream({ start() { /* intentionally never close */ } }), { status: 200 }) };
  const client = new ApiClient('http://127.0.0.1', 'token', partialBody);
  await assert.rejects(() => client.request('/partial', {}, 20), (error: ApiError) => error.category === 'transport' && error.message.includes('请求超时'));
});

test('ApiClient exposes only the safe AI error message envelope', async () => {
  const client = new ApiClient('http://localhost', 'token', { fetch: async () => new Response(JSON.stringify({ detail: { code: 'unauthorized', message: 'API Key 无效或无权访问该模型' } }), { status: 400 }) });
  await assert.rejects(() => client.testAiConnection({ provider: 'deepseek', base_url: 'https://api.deepseek.com', model: 'deepseek-v4-flash', api_key: 'synthetic-key', thinking_enabled: false, timeout_seconds: 30, max_output_tokens: 16 }), /API Key 无效/);
});

test('ApiClient preserves a stable backend error code for generation error mapping', async () => {
  const client = new ApiClient('http://localhost', 'token', { fetch: async () => new Response(JSON.stringify({ detail: { code: 'context_not_found', message: 'Context package was not found' } }), { status: 404 }) });
  await assert.rejects(() => client.createAiSummaryGeneration('missing', { profile_id: 'p', provider: 'deepseek', base_url: 'https://provider.example/v1', model: 'm', thinking_enabled: false, timeout_seconds: 30, max_output_tokens: 20, api_key: 'synthetic-secret' }, 'key'), (error: ApiError) => error.status === 404 && error.errorCode === 'context_not_found' && !error.message.includes('synthetic-secret'));
});

test('ApiClient treats an empty active task envelope as normal', async () => {
  const transport: HttpTransport = { fetch: async () => new Response(JSON.stringify({ task: null }), { status: 200 }) };
  assert.equal(await new ApiClient('http://localhost', 'token', transport).activeTask(), null);
});

test('ApiClient rejects an invalid active task response instead of hiding it', async () => {
  const transport: HttpTransport = { fetch: async () => new Response(JSON.stringify(null), { status: 200 }) };
  await assert.rejects(() => new ApiClient('http://localhost', 'token', transport).activeTask(), (error: ApiError) => error.category === 'protocol' && error.message === '活动任务响应格式无效');
});

test('ApiClient lists only completed tasks for the context picker', async () => {
  let url = '';
  const client = new ApiClient('http://localhost', 'token', { fetch: async input => { url = String(input); return new Response(JSON.stringify([]), { status: 200 }); } });
  assert.deepEqual(await client.listTasks('completed'), []);
  assert.equal(url, 'http://localhost/tasks?status=completed');
});

test('ApiClient uses the Stage 9 generation endpoints and does not put the provider key in a URL', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const client = new ApiClient('http://localhost', 'token', { fetch: async (input, init) => { calls.push({ url: String(input), init }); return new Response(JSON.stringify(calls.length === 1 ? { job_id: 'job', status: 'queued' } : calls.length === 2 ? { id: 'job', context_id: 'ctx', status: 'running' } : { items: [] }), { status: 200 }); } });
  await client.createAiSummaryGeneration('ctx', { profile_id: 'profile', provider: 'deepseek', base_url: 'https://provider.example/v1', model: 'model', thinking_enabled: false, timeout_seconds: 30, max_output_tokens: 20, api_key: 'synthetic-secret' }, 'idempotency');
  await client.getAiGenerationJob('job');
  await client.listAiSummaryDrafts('task');
  assert.equal(calls[0].url, 'http://localhost/ai/context-packages/ctx/summary-generations');
  assert.equal(calls[1].url, 'http://localhost/ai/generation-jobs/job');
  assert.equal(calls[2].url, 'http://localhost/tasks/task/ai/summary-drafts');
  assert.equal(calls.some(call => call.url.includes('synthetic-secret')), false);
  assert.match(String(calls[0].init?.body), /synthetic-secret/);
});
