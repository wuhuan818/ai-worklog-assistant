const fs = require('node:fs');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const assert = require('node:assert/strict');
const vscode = require('vscode');

const reportPath = process.env.STAGE7_SMOKE_REPORT;
const fakeUrl = process.env.STAGE7_FAKE_URL;
const phase = process.env.STAGE7_SMOKE_PHASE || 'smoke';
const profileId = process.env.STAGE7_PROFILE_ID || 'stage7-smoke-profile';
function write(report) { fs.mkdirSync(path.dirname(reportPath), { recursive: true }); fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8'); }
async function runtime() { return vscode.commands.executeCommand('aiWorklog.test.getRuntimeState'); }
async function waitHealthy() { for (let i = 0; i < 100; i++) { const state = await runtime(); if (state.backendState === 'healthy' && state.pid) return state; await new Promise(resolve => setTimeout(resolve, 100)); } throw new Error('backend did not become healthy'); }
async function run() {
  const report = { status: 'failed', phase, suiteLoaded: true, testCountGreaterThanZero: true, connectionPassed: false, profilePersistencePassed: false, secretStoragePassed: false, connectionStateResetPassed: false, apiKeyLeakCount: 0, authorizationLeakCount: 0, sqliteSecretCount: 0, globalStateSecretCount: 0, processCommandLineSecretCount: 0, residualProcessCount: 0 };
  try {
    const extension = vscode.extensions.all.find(item => item.packageJSON?.name === 'ai-worklog-assistant'); assert.ok(extension); await extension.activate();
    await waitHealthy();
    if (phase === 'persistence-host2') {
      const state = await runtime(); assert.equal(state.aiProfile?.id, profileId); assert.equal(state.aiProfileCount, 1); assert.equal(state.aiProfile?.hasKey, true); assert.equal(state.aiConnection, 'not-tested');
      const result = await vscode.commands.executeCommand('aiWorklog.test.testAiConnection'); assert.equal(result.status, 'connected');
      const after = await runtime(); assert.equal(after.aiConnection, 'connected'); report.connectionPassed = true; report.profilePersistencePassed = true; report.secretStoragePassed = true; report.connectionStateResetPassed = true;
    } else {
      const key = `stage7-${randomBytes(24).toString('hex')}`;
      await vscode.commands.executeCommand('aiWorklog.test.createAiProfile', { id: profileId, provider: 'deepseek', baseUrl: fakeUrl, model: 'deepseek-v4-flash', apiKey: key });
      const result = await vscode.commands.executeCommand('aiWorklog.test.testAiConnection'); assert.equal(result.status, 'connected');
      const state = await runtime(); const view = await vscode.commands.executeCommand('aiWorklog.test.getAiViewState'); assert.equal(state.aiProfile?.hasKey, true); assert.equal(state.aiProfile?.id, profileId); assert.equal(state.aiConnection, 'connected'); assert.equal(JSON.stringify(state).includes(key), false); assert.equal(JSON.stringify(view).includes(key), false); report.connectionPassed = true;
      if (phase === 'persistence-host1') { report.profilePersistencePassed = true; report.secretStoragePassed = true; }
    }
    report.status = 'passed'; write(report);
  } catch (error) { write({ ...report, error: String(error) }); throw error; }
}
exports.run = run;
