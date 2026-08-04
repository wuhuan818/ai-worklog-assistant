import assert from 'node:assert/strict';
import test from 'node:test';
import { previewHtml, previewPayload, readyEligibility } from './previewModel';

test('context preview uses a nonce CSP and renders data through postMessage', () => {
  const html = previewHtml('nonce-value');
  assert.match(html, /default-src 'none'/); assert.match(html, /script-src 'nonce-nonce-value'/); assert.match(html, /postMessage/); assert.doesNotMatch(html, /unsafe-inline/);
});
test('context preview strips secret-shaped fields before presentation', () => {
  const payload = previewPayload({ id: 'ctx', context_id: 'ctx', status: 'preview', content_hash: 'hash', estimated_tokens: 428, redaction_count: 1, truncation_count: 0, context: { schema_version: 'task-context-package/v1', task: {}, privacy: { raw_secret_retained: false }, budget: { estimated_token_budget: 32000 }, provenance: {}, manual_notes: ['safe'], api_key: 'must-not-render', nested: { Authorization: 'Bearer no' } } });
  assert.equal(((payload.context as Record<string, unknown>).api_key), '<redacted>');
  assert.equal((((payload.context as Record<string, unknown>).nested as Record<string, unknown>).Authorization), '<redacted>');
  assert.equal(payload.estimated_tokens, 428);
});
test('empty context is not eligible to be marked ready', () => {
  const value = { id: 'ctx', context_id: 'ctx', status: 'preview' as const, content_hash: 'hash', estimated_tokens: 428, redaction_count: 0, truncation_count: 0, context: { schema_version: 'task-context-package/v1' as const, task: {}, privacy: { raw_secret_retained: false }, budget: { estimated_token_budget: 32000 }, provenance: {} } };
  assert.equal(readyEligibility(value).allowed, false);
  value.context.task = { task_id: 'task' };
  assert.equal(readyEligibility(value).allowed, true);
});
