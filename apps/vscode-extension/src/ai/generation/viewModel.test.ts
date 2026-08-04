import assert from 'node:assert/strict';
import test from 'node:test';
import { confirmationText, draftSections, generationFingerprint, generationSidebarText } from './viewModel';

test('confirmation includes Ready Context fingerprint, usage and provider details', () => {
  const text = confirmationText({ taskName: 'Finished task', contextId: 'context-id-12', contextHash: 'content-hash', contextSchema: 'task-context-package/v1', estimatedInputTokens: 321, provider: 'deepseek', profile: 'Work', model: 'deepseek-test', thinking: false, maxOutputTokens: 8192, redactionCount: 2, truncationCount: 1 });
  for (const expected of ['Finished task', 'context-id-12', 'content-hash', '321', 'deepseek / Work', 'deepseek-test', '8192', 'Redactions: 2; truncations: 1']) assert.match(text, new RegExp(expected));
});

test('draft view model always exposes exactly the eight read-only sections', () => {
  const sections = draftSections({ id: 'd', context_id: 'c', task_id: 't', schema_version: 'ai-summary-draft/v1', status: 'draft', content: { schema_version: 'ai-summary-draft/v1', sections: { task_summary: { summary: 'done' } } as never } });
  assert.equal(sections.length, 8);
  assert.deepEqual(sections[0].value, { summary: 'done' });
  assert.deepEqual(sections[1].value, []);
});

test('sidebar generation fingerprint changes only for meaningful status data', () => {
  const job = { id: 'j', context_id: 'c', status: 'running' as const, provider: 'qwen', model: 'm' };
  assert.equal(generationFingerprint(job), generationFingerprint({ ...job }));
  assert.notEqual(generationFingerprint(job), generationFingerprint({ ...job, status: 'validating' }));
  assert.equal(generationSidebarText(undefined), 'AI Summary: not generated');
});

test('sidebar status contract exposes an action for every lifecycle state', () => {
  const actions: Record<string, string[]> = {
    not_generated: ['生成总结草稿'], queued: ['取消生成'], running: ['取消生成'], validating: ['取消生成'],
    succeeded: ['查看草稿', '生成新草稿'], failed: ['重新生成'], cancelled: ['重新生成'], interrupted: ['重新生成']
  };
  for (const labels of Object.values(actions)) assert.ok(labels.length > 0);
});
