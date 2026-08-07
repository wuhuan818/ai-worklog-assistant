export interface ProjectView { id: string; user_id: string; name: string; workspace_path?: string | null; workspace_identity_key?: string | null; created_at: string; updated_at: string; }
export interface ProjectResolution { project: ProjectView; created: boolean; matched_by: string; }
export interface TaskView { id: string; project_id: string; name: string; description?: string; requirement_id?: string; status: string; started_at: string; ended_at?: string | null; duration_seconds?: number | null; tags: string[]; }
export interface ActiveTaskResponse { task: TaskView | null; }
export type WorklogEventType = 'file_changed'|'file_saved'|'diagnostics_changed'|'vscode_task_started'|'vscode_task_process_started'|'vscode_task_process_ended'|'vscode_task_ended'|'debug_session_started'|'debug_session_terminated'|'debug_active_session_changed'|'manual_note'|'bug_note_added';
export interface WorklogEvent { id: string; clientEventId: string; taskId: string; bugId?: string | null; eventType: WorklogEventType; source: 'vscode'; workspacePath?: string; filePath?: string; occurredAt: string; createdAt: string; sequence: number; payload: Record<string, unknown>; }
export interface EventSummary { total: number; by_type: Record<string, number>; latest_event_at: string | null; }
export type BugStatus = 'open' | 'active' | 'paused' | 'resolved';
export type BugSeverity = 'low' | 'medium' | 'high' | 'critical';
export interface BugView { id: string; user_id: string; project_id: string; task_id: string; title: string; description?: string | null; severity: BugSeverity; category?: string | null; source?: string | null; external_reference?: string | null; tags: string[]; status: BugStatus; created_at: string; updated_at: string; activated_at?: string | null; paused_at?: string | null; resolved_at?: string | null; reopened_at?: string | null; total_active_seconds: number; }
export interface BugNote { id: string; client_note_id: string; user_id: string; task_id: string; bug_id: string; text: string; created_at: string; }
export interface BugResolution { id: string; user_id: string; task_id: string; bug_id: string; resolution_summary: string; root_cause?: string | null; verification?: string | null; created_at: string; }
export interface BugListResponse { items: BugView[]; total: number; limit: number; offset: number; }
export interface HttpTransport { fetch(input: string, init?: RequestInit): Promise<Response>; }
export interface AiConnectionResult { ok: boolean; provider: string; model: string; latency_ms: number; status: string; capabilities: Record<string, boolean>; }
export interface AiContextBuildConfig { schema_version: 'context-build-config/v1'; estimated_input_token_budget: number; include_manual_notes: boolean; include_bug_details: boolean; include_file_changes: boolean; include_diff_snippets: boolean; include_diagnostics: boolean; include_commands_and_tasks: boolean; include_debug_events: boolean; include_event_summary: boolean; }
export interface AiContextBody { schema_version: 'task-context-package/v1'; task: Record<string, unknown>; privacy: Record<string, unknown>; budget: Record<string, unknown>; provenance: Record<string, unknown>; [key: string]: unknown; }
export interface AiContextPackage { id: string; context_id: string; status: 'preview' | 'ready' | 'superseded' | 'invalid'; context: AiContextBody; content_hash: string; estimated_tokens: number; redaction_count: number; truncation_count: number; created_at?: string; updated_at?: string; ready_at?: string | null; }
export interface AiContextPackageList { items: AiContextPackage[]; total?: number; }
export type AiGenerationStatus = 'queued' | 'running' | 'validating' | 'succeeded' | 'failed' | 'cancelled' | 'interrupted';
export interface AiGenerationProfile { profile_id: string; provider: string; base_url: string; model: string; thinking_enabled: boolean; timeout_seconds: number; max_output_tokens: number; api_key: string; }
export interface AiGenerationJob { id?: string; job_id?: string; context_id: string; task_id?: string; status: AiGenerationStatus; provider?: string; model?: string; attempt_count?: number; error_code?: string | null; error_summary?: string | null; input_estimated_tokens?: number; provider_prompt_tokens?: number | null; provider_completion_tokens?: number | null; provider_total_tokens?: number | null; latency_ms?: number | null; draft_id?: string | null; }
export interface AiSummaryDraft { id: string; context_id: string; task_id: string; schema_version: 'ai-summary-draft/v1'; status: 'draft'; content_json?: AiSummaryDraftContent; content?: AiSummaryDraftContent; provider?: string; model?: string; prompt_version?: string; context_hash?: string; output_redaction_count?: number; created_at?: string; updated_at?: string; }
export interface AiSummaryDraftContent { schema_version: 'ai-summary-draft/v1'; sections: Record<'task_summary' | 'code_changes' | 'commands_and_results' | 'bug_solutions' | 'unresolved_issues' | 'todos' | 'daily_report' | 'knowledge_candidates', unknown>; }
export interface AiSummaryRevision { id: string; task_id: string; draft_id: string; revision_number: number; schema_version: 'ai-summary-draft/v1'; content: AiSummaryDraftContent; source: string; created_at: string; }
export interface AiSummaryReview { id: string; task_id: string; draft_id: string; revision_id?: string | null; status: 'pending' | 'approved' | 'rejected'; rejection_reason?: string | null; superseded_at?: string | null; created_at: string; }
export interface Publication { id: string; task_id: string; revision_id: string; logical_path: string; status: string; published_at: string; title?: string; category?: string; candidate_index?: number; }
export interface KnowledgeCandidate { candidate_index: number; title: string; category: string; summary: string; why_reusable: string; }
export interface BackendHealth { status: string; service: string; api_version?: string; features?: string[]; build_commit?: string; }

export class ApiError extends Error {
  constructor(public readonly status: number, message: string, public readonly category: 'http' | 'transport' | 'protocol' = 'http', public readonly errorCode?: string) { super(message); this.name = 'ApiError'; }
}

export class ApiClient {
  constructor(private readonly baseUrl: string, private readonly token: string, private readonly transport: HttpTransport = { fetch }) {}

  async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = { 'content-type': 'application/json', authorization: `Bearer ${this.token}`, ...(init.headers || {}) };
    let response: Response;
    try { response = await this.transport.fetch(`${this.baseUrl}${path}`, { ...init, headers }); }
    catch (error) { throw new ApiError(0, `后端不可用：${error instanceof Error ? error.message : String(error)}`, 'transport'); }
    if (!response.ok) {
      let message = await response.text();
      let errorCode: string | undefined;
      try { const parsed = JSON.parse(message) as { detail?: string | { code?: string; message?: string } }; const detail = parsed.detail; if (typeof detail !== 'string') errorCode = detail?.code; message = typeof detail === 'string' ? detail : detail?.message || message; } catch { /* preserve non-JSON server errors */ }
      throw new ApiError(response.status, message, 'http', errorCode);
    }
    return response.json() as Promise<T>;
  }

  health(): Promise<BackendHealth> { return this.request('/health', { headers: {} }); }
  shutdown(generation: number): Promise<{ accepted: boolean; generation: number }> { return this.request('/runtime/shutdown', { method: 'POST', body: JSON.stringify({ generation }) }); }
  listProjects(): Promise<ProjectView[]> { return this.request('/projects'); }
  listTasks(status?: string): Promise<TaskView[]> { const query = status ? `?${new URLSearchParams({ status })}` : ''; return this.request(`/tasks${query}`); }
  createProject(input: { name: string; workspace_path?: string; workspace_identity_key?: string; workspace_identity_version?: number; workspace_kind?: string; canonical_workspace_uri?: string }): Promise<ProjectView> { return this.request('/projects', { method: 'POST', body: JSON.stringify(input) }); }
  resolveProject(input: { name: string; workspace_path?: string; workspace_identity_key: string; workspace_identity_version: number; workspace_kind: string; canonical_workspace_uri?: string }): Promise<ProjectResolution> { return this.request('/projects/resolve', { method: 'POST', body: JSON.stringify(input) }); }
  async activeTask(): Promise<TaskView | null> {
    const response = await this.request<ActiveTaskResponse>('/tasks/active');
    if (!response || !Object.prototype.hasOwnProperty.call(response, 'task') || (response.task !== null && typeof response.task !== 'object')) {
      throw new ApiError(0, '活动任务响应格式无效', 'protocol');
    }
    return response.task;
  }
  createTask(input: { name: string; project?: string; project_id?: string; description?: string; requirement_id?: string; tags?: string[] }): Promise<TaskView> { return this.request('/tasks', { method: 'POST', body: JSON.stringify(input) }); }
  endTask(taskId: string): Promise<TaskView> { return this.request(`/tasks/${taskId}/end`, { method: 'POST' }); }
  addEvent(event: Record<string, unknown>): Promise<{ id: string }> { return this.request('/events', { method: 'POST', body: JSON.stringify(event) }); }
  batchEvents(taskId: string, events: Array<Record<string, unknown>>): Promise<{ inserted: number; duplicates: number; event_ids: string[] }> { return this.request(`/tasks/${taskId}/events/batch`, { method: 'POST', body: JSON.stringify({ events }) }); }
  listEvents(taskId: string, limit = 20, options: { offset?: number; eventType?: string; bugId?: string } = {}): Promise<{ items: WorklogEvent[]; total: number; limit: number; offset: number }> { const query = new URLSearchParams({ limit: String(limit), ...(options.offset !== undefined ? { offset: String(options.offset) } : {}), ...(options.eventType ? { event_type: options.eventType } : {}), ...(options.bugId ? { bug_id: options.bugId } : {}) }); return this.request(`/tasks/${taskId}/events?${query}`); }
  eventSummary(taskId: string): Promise<EventSummary> { return this.request(`/tasks/${taskId}/events/summary`); }
  listBugs(taskId: string, options: { status?: BugStatus; severity?: BugSeverity; limit?: number; offset?: number } = {}): Promise<BugListResponse> { const query = new URLSearchParams(Object.entries(options).filter(([, value]) => value !== undefined).map(([key, value]) => [key, String(value)])); return this.request(`/tasks/${taskId}/bugs${query.size ? `?${query}` : ''}`); }
  createBug(taskId: string, input: { title: string; description?: string; severity: BugSeverity; category?: string; source?: string; external_reference?: string; tags?: string[]; activate_immediately?: boolean }): Promise<BugView> { return this.request(`/tasks/${taskId}/bugs`, { method: 'POST', body: JSON.stringify(input) }); }
  currentBug(taskId: string): Promise<BugView | null> { return this.request<{ bug: BugView | null }>(`/tasks/${taskId}/bugs/current`).then(response => response.bug); }
  getBug(taskId: string, bugId: string): Promise<BugView> { return this.request(`/tasks/${taskId}/bugs/${bugId}`); }
  activateBug(taskId: string, bugId: string): Promise<BugView> { return this.request<BugView | { active_bug: BugView }>(`/tasks/${taskId}/bugs/${bugId}/activate`, { method: 'POST' }).then(value => 'active_bug' in value ? value.active_bug : value); }
  pauseBug(taskId: string, bugId: string): Promise<BugView> { return this.request(`/tasks/${taskId}/bugs/${bugId}/pause`, { method: 'POST' }); }
  resolveBug(taskId: string, bugId: string, input: { resolution_summary: string; root_cause?: string; verification?: string }): Promise<BugView> { return this.request(`/tasks/${taskId}/bugs/${bugId}/resolve`, { method: 'POST', body: JSON.stringify(input) }); }
  reopenBug(taskId: string, bugId: string): Promise<BugView> { return this.request(`/tasks/${taskId}/bugs/${bugId}/reopen`, { method: 'POST' }); }
  listBugNotes(taskId: string, bugId: string): Promise<BugNote[]> { return this.request(`/tasks/${taskId}/bugs/${bugId}/notes`); }
  addBugNote(taskId: string, bugId: string, input: { client_note_id: string; text: string }): Promise<BugNote> { return this.request(`/tasks/${taskId}/bugs/${bugId}/notes`, { method: 'POST', body: JSON.stringify(input) }); }
  listBugResolutions(taskId: string, bugId: string): Promise<BugResolution[]> { return this.request(`/tasks/${taskId}/bugs/${bugId}/resolutions`); }
  listBugEvents(taskId: string, bugId: string, limit = 100, offset = 0, eventType?: string): Promise<{ items: WorklogEvent[]; total: number; limit: number; offset: number }> { return this.listEvents(taskId, limit, { offset, eventType, bugId }); }
  generateSummary(taskId: string): Promise<Record<string, unknown>> { return this.request(`/tasks/${taskId}/summaries/generate`, { method: 'POST' }); }
  private validContextPackage(value: unknown): AiContextPackage {
    const item = value as Partial<AiContextPackage>;
    const context = item?.context;
    if (!item || typeof item.id !== 'string' || typeof item.context_id !== 'string' || typeof item.status !== 'string' || typeof item.content_hash !== 'string' || typeof item.estimated_tokens !== 'number' || !Number.isFinite(item.estimated_tokens) || !context || typeof context !== 'object' || context.schema_version !== 'task-context-package/v1' || !context.task || !context.privacy || !context.budget || !context.provenance) throw new ApiError(0, 'AI Context 响应格式无效', 'protocol');
    return item as AiContextPackage;
  }
  async buildAiContext(taskId: string, config: AiContextBuildConfig, idempotencyKey: string): Promise<AiContextPackage> { return this.validContextPackage(await this.request(`/tasks/${taskId}/ai/context-packages`, { method: 'POST', body: JSON.stringify({ config, idempotency_key: idempotencyKey }) })); }
  async listAiContexts(taskId: string): Promise<AiContextPackage[]> { const response = await this.request<AiContextPackage[] | AiContextPackageList>(`/tasks/${taskId}/ai/context-packages`); return (Array.isArray(response) ? response : response.items).map(item => this.validContextPackage(item)); }
  async getAiContext(contextId: string): Promise<AiContextPackage> { return this.validContextPackage(await this.request(`/ai/context-packages/${contextId}`)); }
  async markAiContextReady(contextId: string): Promise<AiContextPackage> { return this.validContextPackage(await this.request(`/ai/context-packages/${contextId}/ready`, { method: 'POST' })); }
  createAiSummaryGeneration(contextId: string, profile: AiGenerationProfile, idempotencyKey: string): Promise<AiGenerationJob> { return this.request(`/ai/context-packages/${contextId}/summary-generations`, { method: 'POST', body: JSON.stringify({ profile, idempotency_key: idempotencyKey }) }); }
  getAiGenerationJob(jobId: string): Promise<AiGenerationJob> { return this.request(`/ai/generation-jobs/${jobId}`); }
  cancelAiGenerationJob(jobId: string): Promise<AiGenerationJob> { return this.request(`/ai/generation-jobs/${jobId}/cancel`, { method: 'POST' }); }
  listAiSummaryDrafts(taskId: string): Promise<AiSummaryDraft[]> { return this.request<AiSummaryDraft[] | { items: AiSummaryDraft[] }>(`/tasks/${taskId}/ai/summary-drafts`).then(value => Array.isArray(value) ? value : value.items); }
  getAiSummaryDraft(draftId: string): Promise<AiSummaryDraft> { return this.request(`/ai/summary-drafts/${draftId}`); }
  listAiSummaryRevisions(draftId: string): Promise<AiSummaryRevision[]> { return this.request<{ items: AiSummaryRevision[] }>(`/ai/summary-drafts/${draftId}/revisions`).then(value => value.items); }
  getAiSummaryRevision(revisionId: string): Promise<AiSummaryRevision> { return this.request(`/ai/summary-revisions/${revisionId}`); }
  saveAiSummaryRevision(taskId: string, draftId: string, content: AiSummaryDraftContent, idempotencyKey: string): Promise<AiSummaryRevision> { return this.request(`/tasks/${taskId}/ai/summary-drafts/${draftId}/revisions`, { method: 'POST', body: JSON.stringify({ content, idempotency_key: idempotencyKey }) }); }
  approveAiSummaryRevision(taskId: string, draftId: string, revisionId: string): Promise<AiSummaryReview> { return this.request(`/tasks/${taskId}/ai/summary-drafts/${draftId}/revisions/${revisionId}/approve`, { method: 'POST' }); }
  rejectAiSummaryContent(taskId: string, draftId: string, revisionId: string | undefined, reason: string): Promise<AiSummaryReview> { return this.request(`/tasks/${taskId}/ai/summary-drafts/${draftId}/reject`, { method: 'POST', body: JSON.stringify({ revision_id: revisionId, reason }) }); }
  getAiSummaryReviews(taskId: string): Promise<{ current: AiSummaryReview | null; history: AiSummaryReview[] }> { return this.request(`/tasks/${taskId}/ai/summary-reviews`); }
  publishingStatus(taskId: string): Promise<{ approved_revision: AiSummaryReview | null; exports: Publication[]; knowledge: Publication[] }> { return this.request(`/tasks/${taskId}/ai/publishing-status`); }
  exportApprovedSummary(taskId: string): Promise<Publication> { return this.request(`/tasks/${taskId}/ai/exports/summary`, { method: 'POST' }); }
  exportApprovedDailyReport(taskId: string): Promise<Publication> { return this.request(`/tasks/${taskId}/ai/exports/daily-report`, { method: 'POST' }); }
  knowledgeCandidates(taskId: string): Promise<KnowledgeCandidate[]> { return this.request<{ items: KnowledgeCandidate[] }>(`/tasks/${taskId}/ai/knowledge-candidates`).then(value => value.items); }
  publishKnowledge(taskId: string, items: KnowledgeCandidate[]): Promise<{ items: Publication[] }> { return this.request(`/tasks/${taskId}/ai/knowledge-publications`, { method: 'POST', body: JSON.stringify({ items }) }); }
  testAiConnection(input: { provider: string; base_url: string; model: string; api_key: string; thinking_enabled: boolean; timeout_seconds: number; max_output_tokens: number }): Promise<AiConnectionResult> { return this.request('/ai/providers/test-connection', { method: 'POST', body: JSON.stringify(input) }); }
}
