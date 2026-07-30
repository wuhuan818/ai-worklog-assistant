import * as path from 'node:path';
import * as vscode from 'vscode';
const excluded = /(^|[\\/])(?:\.git|node_modules|dist|build|out|coverage|\.venv|venv|__pycache__)([\\/]|$)|\.(png|jpg|jpeg|gif|zip|exe|dll|pdf|class|jar)$/i;
export function relativeFilePath(uri: vscode.Uri): { workspacePath?: string; filePath?: string } { const folder = vscode.workspace.getWorkspaceFolder(uri); if (!folder || excluded.test(uri.fsPath)) return {}; return { workspacePath: folder.uri.fsPath, filePath: path.relative(folder.uri.fsPath, uri.fsPath).replaceAll('\\', '/') }; }
export function safePayload(payload: Record<string, unknown>): Record<string, unknown> { const text = JSON.stringify(payload); return text.length > 262144 ? { truncated: true, reason: 'payload_size_limit' } : payload; }
