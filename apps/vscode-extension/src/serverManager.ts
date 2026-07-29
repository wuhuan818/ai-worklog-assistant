import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { BackendProcessManager } from './backendProcessManager';
import { resolveBackendExecutable } from './backendPath';
import { BackendLogger } from './backendProcessManager';

function workspaceRoot(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

export class ServerManager extends BackendProcessManager {
  constructor(context: vscode.ExtensionContext, logger: BackendLogger, logPath: string) {
    const config = vscode.workspace.getConfiguration('aiWorklog');
    const configuredPath = config.get<string>('serverPath', '');
    const port = config.get<number>('serverPort', 8765);
    const dataDir = config.get<string>('dataDir', '')
      || path.join(process.env.LOCALAPPDATA || context.globalStorageUri.fsPath, 'AIWorklogAssistant');
    const root = workspaceRoot();
    logger.appendLine(`extensionPath=${context.extensionPath}`);
    logger.appendLine(`workspace=${root || '(none)'}`);
    logger.appendLine(`用户数据目录=${dataDir}`);
    logger.appendLine(`持久诊断日志=${logPath}`);
    super({
      executablePath: () => resolveBackendExecutable({ extensionPath: context.extensionPath, workspaceRoot: root, configuredPath }),
      port,
      dataDir,
      logger,
      mkdir: directory => fs.mkdirSync(directory, { recursive: true }),
      logPath,
    });
  }
}
