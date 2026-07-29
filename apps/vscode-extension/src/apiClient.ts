export interface TaskView { id: string; project_id: string; name: string; status: string; started_at: string; ended_at?: string | null; tags: string[]; }
export interface HttpTransport { fetch(input: string, init?: RequestInit): Promise<Response>; }

export class ApiError extends Error {
  constructor(public readonly status: number, message: string) { super(message); this.name = 'ApiError'; }
}

export class ApiClient {
  constructor(private readonly baseUrl: string, private readonly token: string, private readonly transport: HttpTransport = { fetch }) {}

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = { 'content-type': 'application/json', authorization: `Bearer ${this.token}`, ...(init.headers || {}) };
    let response: Response;
    try { response = await this.transport.fetch(`${this.baseUrl}${path}`, { ...init, headers }); }
    catch (error) { throw new ApiError(0, `后端不可用：${error instanceof Error ? error.message : String(error)}`); }
    if (!response.ok) throw new ApiError(response.status, await response.text());
    return response.json() as Promise<T>;
  }

  health(): Promise<{ status: string; service: string }> { return this.request('/health', { headers: {} }); }
  createTask(input: { name: string; project: string; description?: string; requirement_id?: string; tags?: string[] }): Promise<TaskView> { return this.request('/tasks', { method: 'POST', body: JSON.stringify(input) }); }
  endTask(taskId: string): Promise<TaskView> { return this.request(`/tasks/${taskId}/end`, { method: 'POST' }); }
  addEvent(event: Record<string, unknown>): Promise<{ id: string }> { return this.request('/events', { method: 'POST', body: JSON.stringify(event) }); }
  createBug(taskId: string, title: string): Promise<Record<string, unknown>> { return this.request(`/tasks/${taskId}/bugs`, { method: 'POST', body: JSON.stringify({ title }) }); }
  resolveBug(bugId: string): Promise<Record<string, unknown>> { return this.request(`/bugs/${bugId}/resolve`, { method: 'POST' }); }
  generateSummary(taskId: string): Promise<Record<string, unknown>> { return this.request(`/tasks/${taskId}/summaries/generate`, { method: 'POST' }); }
}
