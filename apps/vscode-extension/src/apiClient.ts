export interface ProjectView { id: string; user_id: string; name: string; workspace_path?: string | null; created_at: string; updated_at: string; }
export interface TaskView { id: string; project_id: string; name: string; description?: string; requirement_id?: string; status: string; started_at: string; ended_at?: string | null; duration_seconds?: number | null; tags: string[]; }
export interface ActiveTaskResponse { task: TaskView | null; }
export interface HttpTransport { fetch(input: string, init?: RequestInit): Promise<Response>; }

export class ApiError extends Error {
  constructor(public readonly status: number, message: string, public readonly category: 'http' | 'transport' | 'protocol' = 'http') { super(message); this.name = 'ApiError'; }
}

export class ApiClient {
  constructor(private readonly baseUrl: string, private readonly token: string, private readonly transport: HttpTransport = { fetch }) {}

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
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
  createProject(input: { name: string; workspace_path?: string }): Promise<ProjectView> { return this.request('/projects', { method: 'POST', body: JSON.stringify(input) }); }
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
  createBug(taskId: string, title: string): Promise<Record<string, unknown>> { return this.request(`/tasks/${taskId}/bugs`, { method: 'POST', body: JSON.stringify({ title }) }); }
  resolveBug(bugId: string): Promise<Record<string, unknown>> { return this.request(`/bugs/${bugId}/resolve`, { method: 'POST' }); }
  generateSummary(taskId: string): Promise<Record<string, unknown>> { return this.request(`/tasks/${taskId}/summaries/generate`, { method: 'POST' }); }
}
