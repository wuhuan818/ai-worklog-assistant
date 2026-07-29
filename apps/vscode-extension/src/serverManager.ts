import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { BackendProcessManager } from './backendProcessManager';
import { resolveBackendExecutable } from './backendPath';

function workspaceRoot(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

export class ServerManager extends BackendProcessManager {
  constructor(context: vscode.ExtensionContext) {
    const config = vscode.workspace.getConfiguration('aiWorklog');
    const configuredPath = config.get<string>('serverPath', '');
    const port = config.get<number>('serverPort', 8765);
    const dataDir = config.get<string>('dataDir', '')
      || path.join(process.env.LOCALAPPDATA || context.globalStorageUri.fsPath, 'AIWorklogAssistant');
    const root = workspaceRoot();
    const output = vscode.window.createOutputChannel('AI Worklog');
    output.appendLine(`后端日志位置：Output > AI Worklog；数据目录：${dataDir}`);
    super({
      executablePath: () => resolveBackendExecutable({ extensionPath: context.extensionPath, workspaceRoot: root, configuredPath }),
      port,
      dataDir,
      logger: output,
      mkdir: directory => fs.mkdirSync(directory, { recursive: true }),
    });
    context.subscriptions.push(output);
  }
}
