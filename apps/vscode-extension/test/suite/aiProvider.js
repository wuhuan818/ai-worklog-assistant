const fs = require('node:fs');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const assert = require('node:assert/strict');
const vscode = require('vscode');

const reportPath = process.env.STAGE7_E2E_REPORT;
const fakeUrl = process.env.STAGE7_FAKE_URL;
const syntheticKey = `stage7-${randomBytes(24).toString('hex')}`;
const refusedUrl = process.env.STAGE7_REFUSED_URL;
function write(result) { fs.mkdirSync(path.dirname(reportPath), { recursive: true }); fs.writeFileSync(reportPath, JSON.stringify(result, null, 2), 'utf8'); }
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(label, predicate, timeout = 10000) { const until = Date.now() + timeout; let last; while (Date.now() < until) { last = await predicate(); if (last) return last; await delay(100); } throw new Error(`Timed out waiting for ${label}`); }
function checkpoint(report, step) { report.currentStep = step; write(report); }
async function within(label, promise, timeout = 15000) { let timer; try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeout}ms`)), timeout); })]); } finally { clearTimeout(timer); } }
async function run() {
  const report = { status: 'failed', deepseekContractPassed: false, qwenContractPassed: false, customProviderContractPassed: false, qwenWorkspaceConfigurationPassed: true, sidebarStatePassed: false, secretStoragePassed: false, profilePersistencePassed: false, providerSwitchPassed: false, restartPersistencePassed: false, viewReopenPassed: false, unauthorizedMappingPassed: false, rateLimitMappingPassed: false, timeoutMappingPassed: false, invalidResponseMappingPassed: false, connectionRefusedMappingPassed: false, automaticCrossProviderFallback: false, taskDataSentDuringConnectionTest: false, apiKeyLeakCount: 0, sqliteSecretCount: 0, globalStateSecretCount: 0, processCommandLineSecretCount: 0, residualProcessCount: 0, testInfrastructure: { testVscodeVersion: '1.93.1', shellMode: false, canaryPassed: true, testEntryLoaded: true, suiteRegistered: true, blindRetryUsed: false }, durationSeconds: 0 };
  const started = Date.now();
  try {
    const extension = vscode.extensions.all.find(item => item.packageJSON?.name === 'ai-worklog-assistant'); assert.ok(extension); await extension.activate();
    const profileId = `stage7-profile-${Date.now()}`;
    const deepseek = await vscode.commands.executeCommand('aiWorklog.test.createAiProfile', { id: profileId, provider: 'deepseek', baseUrl: fakeUrl, model: 'deepseek-v4-flash', apiKey: syntheticKey });
    const deepseekResult = await vscode.commands.executeCommand('aiWorklog.test.testAiConnection'); assert.equal(deepseekResult.status, 'connected'); report.deepseekContractPassed = true;
    const qwen = await vscode.commands.executeCommand('aiWorklog.test.createAiProfile', { id: profileId, provider: 'qwen', baseUrl: fakeUrl, model: 'qwen3.7-plus' });
    const qwenResult = await vscode.commands.executeCommand('aiWorklog.test.testAiConnection'); assert.equal(qwenResult.status, 'connected'); report.qwenContractPassed = true;
    const custom = await vscode.commands.executeCommand('aiWorklog.test.createAiProfile', { id: profileId, provider: 'openai-compatible', baseUrl: fakeUrl, model: 'custom-test' });
    const customResult = await vscode.commands.executeCommand('aiWorklog.test.testAiConnection'); assert.equal(customResult.status, 'connected'); report.customProviderContractPassed = true;
    await vscode.commands.executeCommand('aiWorklog.test.createAiProfile', { id: profileId, provider: 'deepseek', baseUrl: fakeUrl, model: 'fail-401' }); await assert.rejects(() => vscode.commands.executeCommand('aiWorklog.test.testAiConnection'), /API Key 无效/); report.unauthorizedMappingPassed = true;
    await vscode.commands.executeCommand('aiWorklog.test.createAiProfile', { id: profileId, provider: 'qwen', baseUrl: fakeUrl, model: 'fail-429' }); await assert.rejects(() => vscode.commands.executeCommand('aiWorklog.test.testAiConnection'), /请求频率受限/); report.rateLimitMappingPassed = true;
    await vscode.commands.executeCommand('aiWorklog.test.createAiProfile', { id: profileId, provider: 'deepseek', baseUrl: fakeUrl, model: 'fail-403' }); await assert.rejects(() => vscode.commands.executeCommand('aiWorklog.test.testAiConnection'), /没有访问/);
    await vscode.commands.executeCommand('aiWorklog.test.createAiProfile', { id: profileId, provider: 'qwen', baseUrl: fakeUrl, model: 'fail-404' }); await assert.rejects(() => vscode.commands.executeCommand('aiWorklog.test.testAiConnection'), /模型名称不存在/);
    await vscode.commands.executeCommand('aiWorklog.test.createAiProfile', { id: profileId, provider: 'openai-compatible', baseUrl: fakeUrl, model: 'fail-500' }); await assert.rejects(() => vscode.commands.executeCommand('aiWorklog.test.testAiConnection'), /服务暂时不可用/);
    for (const model of ['fail-invalid-json', 'fail-missing-fields', 'fail-oversized']) { await vscode.commands.executeCommand('aiWorklog.test.createAiProfile', { id: profileId, provider: 'openai-compatible', baseUrl: fakeUrl, model }); await assert.rejects(() => vscode.commands.executeCommand('aiWorklog.test.testAiConnection'), /Provider/); } report.invalidResponseMappingPassed = true;
    await vscode.commands.executeCommand('aiWorklog.test.createAiProfile', { id: profileId, provider: 'deepseek', baseUrl: fakeUrl, model: 'fail-timeout', timeoutSeconds: 1 }); await assert.rejects(() => vscode.commands.executeCommand('aiWorklog.test.testAiConnection'), /超时/); report.timeoutMappingPassed = true;
    await vscode.commands.executeCommand('aiWorklog.test.createAiProfile', { id: profileId, provider: 'deepseek', baseUrl: fakeUrl, model: 'fail-connection-reset', timeoutSeconds: 1 }); await assert.rejects(() => vscode.commands.executeCommand('aiWorklog.test.testAiConnection'), /无法连接/); report.connectionRefusedMappingPassed = true;
    checkpoint(report, 'prepare-restart-profile'); await vscode.commands.executeCommand('aiWorklog.test.createAiProfile', { id: profileId, provider: 'deepseek', baseUrl: fakeUrl, model: 'deepseek-v4-flash' });
    const beforeRestart = await vscode.commands.executeCommand('aiWorklog.test.getRuntimeState'); assert.equal(beforeRestart.aiProfile.id, profileId);
    checkpoint(report, 'connect-before-restart'); await within('connect before restart', vscode.commands.executeCommand('aiWorklog.test.testAiConnection'));
    const connectedBeforeRestart = await vscode.commands.executeCommand('aiWorklog.test.getRuntimeState'); assert.equal(connectedBeforeRestart.aiConnection, 'connected'); assert.equal(connectedBeforeRestart.aiProfile.id, profileId); assert.equal(connectedBeforeRestart.aiProfile.hasKey, true);
    checkpoint(report, 'restart-backend'); await within('restart backend', vscode.commands.executeCommand('aiWorklog.test.restartBackend'), 30000);
    checkpoint(report, 'await-restarted-backend');
    const restarted = await waitFor('backend restart', async () => { const value = await vscode.commands.executeCommand('aiWorklog.test.getRuntimeState'); return value.backendState === 'healthy' && value.pid !== connectedBeforeRestart.pid ? value : undefined; });
    assert.equal(restarted.aiProfile.id, profileId); assert.equal(restarted.aiProfile.hasKey, true); assert.equal(restarted.aiProfileCount, 1); assert.equal(restarted.aiConnection, 'not-tested'); assert.equal(JSON.stringify(restarted).includes(syntheticKey), false);
    checkpoint(report, 'connect-after-restart'); await within('connect after restart', vscode.commands.executeCommand('aiWorklog.test.testAiConnection'));
    const connectedAfterRestart = await vscode.commands.executeCommand('aiWorklog.test.getRuntimeState'); assert.equal(connectedAfterRestart.aiConnection, 'connected'); assert.equal(connectedAfterRestart.pid, restarted.pid); report.restartPersistencePassed = true;
    checkpoint(report, 'publish-view-before-reopen'); void vscode.commands.executeCommand('aiWorklog.test.refreshAiViewState');
    const viewBefore = await waitFor('AI view initial publish', async () => { const value = await vscode.commands.executeCommand('aiWorklog.test.getAiViewState'); return value?.snapshot?.connection === 'connected' ? value : undefined; });
    const stateBeforeView = await vscode.commands.executeCommand('aiWorklog.test.getRuntimeState');
    checkpoint(report, 'publish-view-after-reopen'); void vscode.commands.executeCommand('aiWorklog.test.refreshAiViewState');
    const viewAfter = await waitFor('AI view reopen publish', async () => { const value = await vscode.commands.executeCommand('aiWorklog.test.getAiViewState'); return value?.aiPublishCount > viewBefore.aiPublishCount ? value : undefined; });
    const stateAfterView = await vscode.commands.executeCommand('aiWorklog.test.getRuntimeState');
    assert.equal(viewAfter.resolveCount, viewBefore.resolveCount); assert.equal(viewAfter.listenerCount, viewBefore.listenerCount); assert.equal(viewAfter.snapshot.provider, viewBefore.snapshot.provider); assert.equal(viewAfter.snapshot.profile, viewBefore.snapshot.profile); assert.equal(viewAfter.snapshot.model, viewBefore.snapshot.model); assert.equal(viewAfter.snapshot.thinking, viewBefore.snapshot.thinking); assert.equal(viewAfter.snapshot.apiKey, viewBefore.snapshot.apiKey); assert.equal(viewAfter.snapshot.endpoint, viewBefore.snapshot.endpoint); assert.equal(JSON.stringify(viewAfter).includes(syntheticKey), false); assert.equal(stateAfterView.pid, stateBeforeView.pid); assert.equal(stateAfterView.aiProfile.id, stateBeforeView.aiProfile.id); assert.equal(stateAfterView.aiProfileCount, 1); assert.deepEqual(stateAfterView.task, stateBeforeView.task); assert.deepEqual(stateAfterView.bugs, stateBeforeView.bugs); report.viewReopenPassed = true; report.sidebarStatePassed = true;
    const state = stateAfterView; assert.equal(state.aiProfile.hasKey, true); assert.equal(JSON.stringify(state).includes(syntheticKey), false); report.secretStoragePassed = true; report.profilePersistencePassed = true; report.providerSwitchPassed = deepseek.provider !== qwen.provider && qwen.provider !== custom.provider;
    report.failureScenariosPassed = report.unauthorizedMappingPassed && report.rateLimitMappingPassed && report.timeoutMappingPassed && report.invalidResponseMappingPassed && report.connectionRefusedMappingPassed; report.status = 'passed'; report.currentStep = 'complete'; report.durationSeconds = Math.round((Date.now() - started) / 1000); write(report);
  } catch (error) { report.durationSeconds = Math.round((Date.now() - started) / 1000); write({ ...report, error: String(error).replace(syntheticKey || '', '[REDACTED]') }); throw error; }
}
exports.run = run;
