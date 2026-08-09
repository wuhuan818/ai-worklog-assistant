import assert from 'node:assert/strict';
import test from 'node:test';
import { captureEligibility, createSaveDiff, DEFAULT_MAX_DIFF_BYTES } from './eventCapture/codeDiff';
import { SaveDiffTracker } from './eventCapture/saveDiffTracker';

test('save-time diff records the C++ replacement exactly', () => {
  const before = 'std::cout << greet(userName) << std::endl;';
  const after = 'std::cout << greet("World") << std::endl;';
  const diff = createSaveDiff(before, after, 'src/hello.cpp', DEFAULT_MAX_DIFF_BYTES);
  assert.ok(diff);
  assert.match(diff.patch, /-std::cout << greet\(userName\) << std::endl;/);
  assert.match(diff.patch, /\+std::cout << greet\("World"\) << std::endl;/);
  assert.equal(diff.addedLines, 1);
  assert.equal(diff.removedLines, 1);
  assert.equal(diff.patchTruncated, false);
});

test('tracker requires a baseline and does not emit a duplicate save diff', () => {
  const tracker = new SaveDiffTracker();
  assert.deepEqual(tracker.capture('file', 'initial', 'a.cpp', 10_000), { kind: 'baseline' });
  tracker.prime('file', 'initial');
  assert.deepEqual(tracker.capture('file', 'initial', 'a.cpp', 10_000), { kind: 'unchanged' });
  const result = tracker.capture('file', 'changed', 'a.cpp', 10_000);
  assert.equal(result.kind, 'diff');
});

test('code capture excludes sensitive, generated, binary, oversized, and configured paths', () => {
  const limits = { maxFileSizeBytes: 16, maxDiffBytes: 1024, exclude: ['private/**'] };
  assert.deepEqual(captureEligibility('.env', 'x', limits), { eligible: false, reason: 'sensitive_file' });
  assert.deepEqual(captureEligibility('src/app.generated.ts', 'x', limits), { eligible: false, reason: 'generated_file' });
  assert.deepEqual(captureEligibility('assets/logo.png', 'x', limits), { eligible: false, reason: 'binary_file' });
  assert.deepEqual(captureEligibility('private/a.cpp', 'x', limits), { eligible: false, reason: 'configured_exclusion' });
  assert.deepEqual(captureEligibility('src/a.cpp', 'x'.repeat(17), limits), { eligible: false, reason: 'file_size_limit' });
  assert.deepEqual(captureEligibility('src/a.cpp', 'safe', limits), { eligible: true });
});

test('diff payload is bounded and explains truncation', () => {
  const diff = createSaveDiff('a'.repeat(500), 'b'.repeat(500), 'src/a.cpp', 120);
  assert.ok(diff && diff.patchTruncated);
  assert.ok(diff.retainedPatchBytes <= 120);
  assert.match(diff.patch, /<diff-truncated>/);
});
