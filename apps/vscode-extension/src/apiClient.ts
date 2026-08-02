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

export class ApiError extends Error {
  constructor(public readonly status: number, message: string, public readonly category: 'http' | 'transport' | 'protocol' = 'http') { super(message); this.name = 'ApiError'; }
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
      try { const parsed = JSON.parse(message) as { detail?: string }; message = parsed.detail || message; } catch { /* preserve non-JSON server errors */ }
      throw new ApiError(response.status, message);
    }
    return response.json() as Promise<T>;
  }

  health(): Promise<{ status: string; service: string }> { return this.request('/health', { headers: {} }); }
  listProjects(): Promise<ProjectView[]> { return this.request('/projects'); }
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
}
