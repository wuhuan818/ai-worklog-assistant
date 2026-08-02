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

test('ApiClient exposes only the safe AI error message envelope', async () => {
  const client = new ApiClient('http://localhost', 'token', { fetch: async () => new Response(JSON.stringify({ detail: { code: 'unauthorized', message: 'API Key 无效或无权访问该模型' } }), { status: 400 }) });
  await assert.rejects(() => client.testAiConnection({ provider: 'deepseek', base_url: 'https://api.deepseek.com', model: 'deepseek-v4-flash', api_key: 'synthetic-key', thinking_enabled: false, timeout_seconds: 30, max_output_tokens: 16 }), /API Key 无效/);
});

test('ApiClient treats an empty active task envelope as normal', async () => {
  const transport: HttpTransport = { fetch: async () => new Response(JSON.stringify({ task: null }), { status: 200 }) };
  assert.equal(await new ApiClient('http://localhost', 'token', transport).activeTask(), null);
});

test('ApiClient rejects an invalid active task response instead of hiding it', async () => {
  const transport: HttpTransport = { fetch: async () => new Response(JSON.stringify(null), { status: 200 }) };
  await assert.rejects(() => new ApiClient('http://localhost', 'token', transport).activeTask(), (error: ApiError) => error.category === 'protocol' && error.message === '活动任务响应格式无效');
});
