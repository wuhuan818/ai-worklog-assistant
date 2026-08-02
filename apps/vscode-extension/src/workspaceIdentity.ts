import * as crypto from 'node:crypto';
import * as path from 'node:path';
import * as vscode from 'vscode';

export interface WorkspaceIdentity {
  version: number;
  kind: 'folder' | 'workspace-file' | 'multi-root';
  canonicalKey: string;
  displayName: string;
  canonicalUris: string[];
  workspaceFileUri?: string;
}

function canonicalUri(uri: vscode.Uri): string {
  let value = uri.scheme === 'file' ? uri.fsPath : uri.toString();
  if (uri.scheme === 'file') value = path.win32.normalize(value.replace(/\//g, '\\')).replace(/\\+$/, '');
  return uri.scheme === 'file' ? `file:///${value.replace(/\\/g, '/').replace(/^([A-Z]):/, (_, drive) => drive.toLowerCase() + ':').toLowerCase()}` : value.toLowerCase();
}

export function resolveWorkspaceIdentity(workspace: Pick<typeof vscode.workspace, 'workspaceFolders' | 'workspaceFile' | 'name'> = vscode.workspace): WorkspaceIdentity | undefined {
  const folders = workspace.workspaceFolders;
  if (!folders?.length) return undefined;
  const roots = folders.map(folder => canonicalUri(folder.uri)).sort();
  const workspaceFile = workspace.workspaceFile ? canonicalUri(workspace.workspaceFile) : undefined;
  const kind: WorkspaceIdentity['kind'] = workspaceFile ? 'workspace-file' : roots.length > 1 ? 'multi-root' : 'folder';
  const material = workspaceFile ? `workspace-file:${workspaceFile}` : `${kind}:${roots.join('|')}`;
  return { version: 1, kind, canonicalKey: crypto.createHash('sha256').update(material).digest('hex'), displayName: workspace.name || folders[0].name, canonicalUris: roots, workspaceFileUri: workspaceFile };
}
