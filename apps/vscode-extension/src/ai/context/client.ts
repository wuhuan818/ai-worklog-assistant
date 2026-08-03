import { ApiClient } from '../../apiClient';
import { ContextBuildConfig, ContextPackage } from './types';

/** Narrow context-only facade: it never reads files, secrets, or provider profiles. */
export class ContextClient {
  constructor(private readonly api: ApiClient) {}
  listCompletedTasks() { return this.api.listTasks('completed'); }
  build(taskId: string, config: ContextBuildConfig, idempotencyKey: string): Promise<ContextPackage> { return this.api.buildAiContext(taskId, config, idempotencyKey); }
  list(taskId: string): Promise<ContextPackage[]> { return this.api.listAiContexts(taskId); }
  get(contextId: string): Promise<ContextPackage> { return this.api.getAiContext(contextId); }
  ready(contextId: string): Promise<ContextPackage> { return this.api.markAiContextReady(contextId); }
}
