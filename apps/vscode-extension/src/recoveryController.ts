import { ApiClient } from './apiClient';
import { TaskState } from './taskState';
import { WorkspaceIdentity } from './workspaceIdentity';

export type RecoveryState = 'idle'|'resolving-workspace'|'waiting-for-backend'|'resolving-project'|'restoring-task'|'ready'|'workspace-conflict'|'error';
export interface RecoveryResult { state: RecoveryState; projectId?: string; conflictTaskName?: string; }

export class RecoveryController {
  state: RecoveryState = 'idle';
  constructor(private readonly taskState: TaskState, private readonly report: (message: string) => void = () => undefined) {}
  async recover(api: ApiClient, identity: WorkspaceIdentity | undefined, workspacePath?: string): Promise<RecoveryResult> {
    try {
      this.state = 'resolving-workspace';
      if (!identity) { this.taskState.clear(); this.state = 'ready'; return { state: this.state }; }
      this.state = 'resolving-project';
      const resolved = await api.resolveProject({ name: identity.displayName, workspace_path: workspacePath, workspace_identity_key: identity.canonicalKey, workspace_identity_version: identity.version, workspace_kind: identity.kind, canonical_workspace_uri: identity.canonicalUris[0] });
      this.state = 'restoring-task';
      const active = await api.activeTask();
      if (active && active.project_id !== resolved.project.id) { this.taskState.clear(); this.state = 'workspace-conflict'; this.report(`其他工作区存在未完成任务：${active.name}`); return { state: this.state, projectId: resolved.project.id, conflictTaskName: active.name }; }
      if (active) this.taskState.setTask(active); else this.taskState.clear();
      this.state = 'ready'; return { state: this.state, projectId: resolved.project.id };
    } catch (error) { this.state = 'error'; this.report(error instanceof Error ? error.message : String(error)); return { state: this.state }; }
  }
}
