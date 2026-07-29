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
