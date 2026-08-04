const assert = require('node:assert/strict');
const vscode = require('vscode');

exports.run = async () => {
  const extension = vscode.extensions.all.find(item => item.packageJSON?.name === 'ai-worklog-assistant');
  assert.ok(extension, 'AI Worklog extension is installed in the test host');
  await extension.activate();
  const commands = await vscode.commands.getCommands(true);
  for (const command of ['aiWorklog.generateAiSummaryDraft', 'aiWorklog.viewAiSummaryDrafts', 'aiWorklog.cancelAiSummaryGeneration']) {
    assert.ok(commands.includes(command), `Missing Stage 09 command: ${command}`);
  }
};
