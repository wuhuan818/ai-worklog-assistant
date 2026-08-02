import assert from 'node:assert/strict';
import test from 'node:test';
import { startBackendOnActivation } from './activationStartup';
import { BackendState } from './backendState';

function fake(state: BackendState, result: 'resolve' | 'reject' = 'resolve') { let calls = 0; const logs: string[] = []; return { backend: { state, start: async () => { calls++; if (result === 'reject') throw new Error('missing executable'); } }, logs, get calls() { return calls; } }; }

test('activation starts a stopped backend exactly once', async () => { const setup = fake('stopped'); await startBackendOnActivation(setup.backend, { appendLine: line => setup.logs.push(line) }); assert.equal(setup.calls, 1); assert.match(setup.logs.join('\n'), /requested[\s\S]*current state=stopped[\s\S]*starting/); assert.match(setup.logs.join('\n'), /healthy/); });
test('activation does not duplicate a healthy backend', async () => { const setup = fake('healthy'); await startBackendOnActivation(setup.backend, { appendLine: line => setup.logs.push(line) }); assert.equal(setup.calls, 0); });
test('activation does not duplicate a backend already starting', async () => { const setup = fake('starting'); await startBackendOnActivation(setup.backend, { appendLine: line => setup.logs.push(line) }); assert.equal(setup.calls, 0); });
test('activation records a sanitized startup failure without throwing', async () => { const setup = fake('stopped', 'reject'); await assert.doesNotReject(() => startBackendOnActivation(setup.backend, { appendLine: line => setup.logs.push(line) })); assert.equal(setup.calls, 1); assert.match(setup.logs.join('\n'), /backend-auto-start-error.*missing executable/); });
