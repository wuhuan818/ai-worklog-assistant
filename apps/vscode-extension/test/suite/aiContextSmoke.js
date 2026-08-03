const vscode = require('vscode');
exports.run = async () => {
  const required = ['aiWorklog.previewAiContext', 'aiWorklog.rebuildAiContext', 'aiWorklog.markAiContextReady'];
  const commands = await vscode.commands.getCommands(true);
  for (const command of required) if (!commands.includes(command)) throw Error(`Missing context command: ${command}`);
};
