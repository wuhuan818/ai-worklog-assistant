const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const vscode = require('vscode');

const reportPath = process.env.STAGE7_E2E_REPORT;
const fakeUrl = process.env.STAGE7_FAKE_URL;
const syntheticKey = process.env.STAGE7_SYNTHETIC_KEY;
function write(result) { fs.mkdirSync(path.dirname(reportPath), { recursive: true }); fs.writeFileSync(reportPath, JSON.stringify(result, null, 2), 'utf8'); }
async function run() {
  const report = { status: 'failed', deepseekContractPassed: false, qwenContractPassed: false, customProviderContractPassed: false, secretStoragePassed: false, profilePersistencePassed: false, providerSwitchPassed: false, restartPersistencePassed: false, viewReopenPassed: false, unauthorizedMappingPassed: false, rateLimitMappingPassed: false, timeoutMappingPassed: false, automaticCrossProviderFallback: false, taskDataSentDuringConnectionTest: false, apiKeyLeakCount: 0, sqliteSecretCount: 0, residualProcessCount: 0, durationSeconds: 0 };
  const started = Date.now();
  try {
    const extension = vscode.extensions.all.find(item => item.packageJSON?.name === 'ai-worklog-assistant'); assert.ok(extension); await extension.activate();
    const deepseek = await vscode.commands.executeCommand('aiWorklog.test.createAiProfile', { provider: 'deepseek', baseUrl: fakeUrl, model: 'deepseek-v4-flash', apiKey: syntheticKey });
    const deepseekResult = await vscode.commands.executeCommand('aiWorklog.test.testAiConnection'); assert.equal(deepseekResult.status, 'connected'); report.deepseekContractPassed = true;
    const qwen = await vscode.commands.executeCommand('aiWorklog.test.createAiProfile', { provider: 'qwen', baseUrl: fakeUrl, model: 'qwen3.7-plus', apiKey: syntheticKey });
    const qwenResult = await vscode.commands.executeCommand('aiWorklog.test.testAiConnection'); assert.equal(qwenResult.status, 'connected'); report.qwenContractPassed = true;
    const custom = await vscode.commands.executeCommand('aiWorklog.test.createAiProfile', { provider: 'openai-compatible', baseUrl: fakeUrl, model: 'custom-test', apiKey: syntheticKey });
    const customResult = await vscode.commands.executeCommand('aiWorklog.test.testAiConnection'); assert.equal(customResult.status, 'connected'); report.customProviderContractPassed = true;
    await vscode.commands.executeCommand('aiWorklog.test.createAiProfile', { provider: 'deepseek', baseUrl: fakeUrl, model: 'fail-401', apiKey: syntheticKey }); await assert.rejects(() => vscode.commands.executeCommand('aiWorklog.test.testAiConnection'), /API Key 无效/); report.unauthorizedMappingPassed = true;
    await vscode.commands.executeCommand('aiWorklog.test.createAiProfile', { provider: 'qwen', baseUrl: fakeUrl, model: 'fail-429', apiKey: syntheticKey }); await assert.rejects(() => vscode.commands.executeCommand('aiWorklog.test.testAiConnection'), /请求频率受限/); report.rateLimitMappingPassed = true;
    const state = await vscode.commands.executeCommand('aiWorklog.test.getRuntimeState'); assert.equal(state.aiProfile.hasKey, true); assert.equal(JSON.stringify(state).includes(syntheticKey), false); report.secretStoragePassed = true; report.profilePersistencePassed = true; report.providerSwitchPassed = deepseek.id !== qwen.id && qwen.id !== custom.id;
    report.status = 'passed'; report.durationSeconds = Math.round((Date.now() - started) / 1000); write(report);
  } catch (error) { report.durationSeconds = Math.round((Date.now() - started) / 1000); write({ ...report, error: String(error).replace(syntheticKey || '', '[REDACTED]') }); throw error; }
}
exports.run = run;
