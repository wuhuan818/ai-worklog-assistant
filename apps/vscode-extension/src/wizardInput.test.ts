import { strict as assert } from 'node:assert';
import test from 'node:test';
import { toInputStepResult } from './wizardStep';
test('undefined is cancellation, not an accepted empty value', () => { assert.equal(toInputStepResult(undefined).kind, 'cancelled'); assert.deepEqual(toInputStepResult(''), { kind: 'accepted', value: '' }); });
test('focus-out hide without accept cannot advance a wizard', () => { const result = toInputStepResult<string>(undefined); assert.equal(result.kind, 'cancelled'); });
