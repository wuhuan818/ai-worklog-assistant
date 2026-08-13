const assert = require('node:assert/strict');
const test = require('node:test');
const { isolatedEnvironment, isProcessAlive, ownedChildPid, REMOVED_ENV, waitForProcessesToExit } = require('./vscodeTestLauncher');

test('isolatedEnvironment strips inherited Electron and VS Code variables', () => {
  const contaminated = Object.fromEntries(REMOVED_ENV.map(key => [key, 'synthetic-contamination']));
  const environment = isolatedEnvironment({ ...contaminated, STAGE4_E2E_RUN_ID: 'safe-run' });
  for (const key of REMOVED_ENV) assert.equal(Object.hasOwn(environment, key), false);
  assert.equal(environment.STAGE4_E2E_RUN_ID, 'safe-run');
});

test('ownedChildPid accepts only the still-running exact child', () => {
  assert.equal(ownedChildPid({ pid: 1234, exitCode: null, signalCode: null }), 1234);
  assert.equal(ownedChildPid({ pid: 1234, exitCode: 0, signalCode: null }), undefined);
  assert.equal(ownedChildPid({ pid: 1234, exitCode: null, signalCode: 'SIGTERM' }), undefined);
  assert.equal(ownedChildPid({ pid: 0, exitCode: null, signalCode: null }), undefined);
});

test('residual checks use exact owned PIDs', async () => {
  assert.equal(isProcessAlive(process.pid), true);
  assert.deepEqual(await waitForProcessesToExit([], 10), []);
});
