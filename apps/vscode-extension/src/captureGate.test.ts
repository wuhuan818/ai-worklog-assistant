import assert from 'node:assert/strict';
import test from 'node:test';
import { CaptureGate } from './eventCapture/captureGate';

test('capture pause is an independent lock that enable cannot release', () => {
  const gate = new CaptureGate();
  gate.pause();
  gate.setEnabled(true);
  assert.equal(gate.enabled, true);
  assert.equal(gate.paused, true);
  assert.equal(gate.accepting, false);

  gate.resume();
  assert.equal(gate.accepting, true);
});

test('resume does not enable capture and disabling remains effective while paused', () => {
  const gate = new CaptureGate();
  gate.pause();
  gate.setEnabled(false);
  gate.resume();
  assert.equal(gate.accepting, false);

  gate.setEnabled(true);
  gate.pause();
  gate.setEnabled(false);
  assert.equal(gate.accepting, false);
  gate.resume();
  assert.equal(gate.accepting, false);
});

test('a completed Task releases its pause before the next Task is enabled', () => {
  const gate = new CaptureGate();
  gate.setEnabled(true);
  gate.pause();
  gate.setEnabled(false);
  gate.resume();
  assert.equal(gate.accepting, false);
  gate.setEnabled(true);
  assert.equal(gate.accepting, true);
});
