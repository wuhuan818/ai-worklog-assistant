import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiClient, HttpTransport } from './apiClient';

test('knowledge search uses an encoded local API query and preserves safe result fields', async () => {
  let requested = '';
  const transport: HttpTransport = { fetch: async input => { requested = String(input); return new Response(JSON.stringify({ items: [{ publication_id: 'pub-1', title: '登录指南', category: '开发', snippet: 'SQLite 登录', score: 8, rank: 1, published_at: '2026-08-07T00:00:00Z', source_ref: 'knowledge-publication:pub-1', task_id: 'task-1', revision_id: 'rev-1', logical_path: 'published/dev/pub-1.md' }] })); } };
  const result = await new ApiClient('http://127.0.0.1:8765', 'token', transport).searchKnowledge('登录 API', 5, '开发');
  assert.match(requested, /knowledge\/search\?q=%E7%99%BB%E5%BD%95\+API&limit=5&category=%E5%BC%80%E5%8F%91/);
  assert.equal(result.items[0].source_ref, 'knowledge-publication:pub-1');
  assert.equal(result.items[0].snippet, 'SQLite 登录');
});
