const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const vscode = require('vscode');

const reportPath = process.env.STAGE071_E2E_REPORT;
function write(value) { fs.mkdirSync(path.dirname(reportPath), { recursive: true }); fs.writeFileSync(reportPath, JSON.stringify(value, null, 2), 'utf8'); }
exports.run = async () => {
  const extension = vscode.extensions.all.find(item => item.packageJSON?.name === 'ai-worklog-assistant');
  assert.ok(extension, 'AI Worklog extension not found');
  await extension.activate();
  const deadline = Date.now() + 30000;
  let state;
  while (Date.now() < deadline) {
    state = await vscode.commands.executeCommand('aiWorklog.test.getRuntimeState');
    if (state?.backendState === 'healthy' && state.pid) break;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  assert.equal(state?.backendState, 'healthy'); assert.ok(state?.pid);
  write({ status: 'host-ready', backendPid: state.pid, generation: state.backendGeneration || 1, extensionInstanceId: state.instanceId || null });
};
