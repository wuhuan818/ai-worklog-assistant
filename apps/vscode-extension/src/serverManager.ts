import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { BackendProcessManager } from './backendProcessManager';
import { resolveBackendExecutable } from './backendPath';
import { BackendLogger } from './backendProcessManager';
import { redactDataPath, resolveRuntimeDataDirectory } from './runtimeData';

function workspaceRoot(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

export class ServerManager extends BackendProcessManager {
  constructor(context: vscode.ExtensionContext, logger: BackendLogger, logPath: string) {
    const config = vscode.workspace.getConfiguration('aiWorklog');
    const configuredPath = config.get<string>('serverPath', '');
    const port = config.get<number>('serverPort', 8765);
    const runtime = resolveRuntimeDataDirectory(context, config.get<string>('dataDir', ''));
    const dataDir = runtime.path;
    const root = workspaceRoot();
    logger.appendLine(`extensionPath=${context.extensionPath}`);
    logger.appendLine(`workspace=${root || '(none)'}`);
    logger.appendLine(`运行模式=${runtime.mode}；数据目录=${redactDataPath(dataDir)}`);
    logger.appendLine(`持久诊断日志=${logPath}`);
    super({
      executablePath: () => resolveBackendExecutable({ extensionPath: context.extensionPath, workspaceRoot: root, configuredPath }),
      port,
      dataDir,
      runtimeMode: runtime.mode,
      logger,
      mkdir: directory => fs.mkdirSync(directory, { recursive: true }),
      logPath,
      runtimeRegistryDir: path.join(context.globalStorageUri.fsPath, 'runtime', 'backend-processes'),
    });
  }
}
