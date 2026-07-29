import * as fs from 'node:fs';
import * as path from 'node:path';

export interface BackendPathOptions {
  extensionPath: string;
  workspaceRoot?: string;
  configuredPath?: string;
  exists?: (candidate: string) => boolean;
}

function unique(paths: string[]): string[] {
  return [...new Set(paths.map(candidate => path.normalize(candidate)))];
}

/** Resolve the packaged backend without depending on a developer's machine path. */
export function resolveBackendExecutable(options: BackendPathOptions): string {
  const exists = options.exists || fs.existsSync;
  const candidates: string[] = [];

  if (options.configuredPath) {
    candidates.push(path.isAbsolute(options.configuredPath)
      ? options.configuredPath
      : path.join(options.workspaceRoot || options.extensionPath, options.configuredPath));
  }

  if (options.workspaceRoot) {
    candidates.push(path.join(options.workspaceRoot, 'artifacts', 'backend', 'ai-worklog-server.exe'));
  }

  candidates.push(path.join(options.extensionPath, 'server', 'ai-worklog-server.exe'));
  candidates.push(path.join(options.extensionPath, 'artifacts', 'backend', 'ai-worklog-server.exe'));
  candidates.push(path.join(options.extensionPath, '..', '..', 'artifacts', 'backend', 'ai-worklog-server.exe'));

  const normalized = unique(candidates);
  const match = normalized.find(candidate => exists(candidate));
  if (match) return path.resolve(match);

  throw new Error(`未找到本地后端可执行程序 ai-worklog-server.exe。已检查路径：${normalized.join('; ')}`);
}
