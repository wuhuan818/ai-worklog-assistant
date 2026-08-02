import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';

export type RuntimeMode = 'production' | 'development' | 'test';
export interface RuntimeDataDirectory { mode: RuntimeMode; path: string; type: 'explicit' | 'global-storage'; }

export function resolveRuntimeDataDirectory(context: vscode.ExtensionContext, configured?: string): RuntimeDataDirectory {
  const explicit = process.env.AI_WORKLOG_DATA_DIR || configured;
  const mode: RuntimeMode = process.env.AI_WORKLOG_RUNTIME_MODE === 'test' || context.extensionMode === vscode.ExtensionMode.Test ? 'test' : context.extensionMode === vscode.ExtensionMode.Development ? 'development' : 'production';
  const target = explicit || path.join(context.globalStorageUri.fsPath, 'data');
  if (!path.isAbsolute(target)) throw new Error('AI Worklog 数据目录必须为绝对路径');
  fs.mkdirSync(target, { recursive: true });
  return { mode, path: path.resolve(target), type: explicit ? 'explicit' : 'global-storage' };
}

export function redactDataPath(value: string): string { const parsed = path.parse(value); return `${parsed.root || '<path>'}...${path.sep}${path.basename(value)}`; }
