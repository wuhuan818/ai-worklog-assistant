import assert from 'node:assert/strict';
import test from 'node:test';
import { previewHtml, previewPayload } from './previewModel';

test('context preview uses a nonce CSP and renders data through postMessage', () => {
  const html = previewHtml('nonce-value');
  assert.match(html, /default-src 'none'/); assert.match(html, /script-src 'nonce-nonce-value'/); assert.match(html, /postMessage/); assert.doesNotMatch(html, /unsafe-inline/);
});
test('context preview strips secret-shaped fields before presentation', () => {
  const payload = previewPayload({ id: 'ctx', schema_version: 'task-context-package/v1', project_id: 'p', task_id: 't', status: 'preview', content_hash: 'hash', context: { manual_notes: ['safe'], api_key: 'must-not-render', nested: { Authorization: 'Bearer no' } } });
  assert.equal(((payload.context as Record<string, unknown>).api_key), '<redacted>');
  assert.equal((((payload.context as Record<string, unknown>).nested as Record<string, unknown>).Authorization), '<redacted>');
});
