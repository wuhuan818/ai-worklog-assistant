import { ActivateBugResult, BugList, BugNote, BugRecord, BugResolution, CreateBugInput, ResolveBugInput } from './types';

export interface BugRequestClient { request<T>(path: string, init?: RequestInit): Promise<T>; }

/** API adapter deliberately depends on the narrow request contract, not ApiClient. */
export class BugService {
  constructor(private readonly client: BugRequestClient) {}
  list(taskId: string, filters: { status?: string; severity?: string; limit?: number; offset?: number } = {}): Promise<BugList> {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) if (value !== undefined) query.set(key, String(value));
    return this.client.request(`/tasks/${encodeURIComponent(taskId)}/bugs${query.size ? `?${query}` : ''}`);
  }
  create(taskId: string, input: CreateBugInput): Promise<BugRecord> { return this.client.request(`/tasks/${encodeURIComponent(taskId)}/bugs`, { method: 'POST', body: JSON.stringify(toApiCreate(input)) }); }
  async current(taskId: string): Promise<BugRecord | null> {
    const response = await this.client.request<{ bug: BugRecord | null }>(`/tasks/${encodeURIComponent(taskId)}/bugs/current`);
    if (!response || !Object.prototype.hasOwnProperty.call(response, 'bug')) throw new Error('当前 Bug 响应格式无效');
    return response.bug;
  }
  activate(taskId: string, bugId: string): Promise<ActivateBugResult> { return this.client.request(`/tasks/${encodeURIComponent(taskId)}/bugs/${encodeURIComponent(bugId)}/activate`, { method: 'POST' }); }
  pause(taskId: string, bugId: string): Promise<BugRecord> { return this.client.request(`/tasks/${encodeURIComponent(taskId)}/bugs/${encodeURIComponent(bugId)}/pause`, { method: 'POST' }); }
  resolve(taskId: string, bugId: string, input: ResolveBugInput): Promise<BugRecord> { return this.client.request(`/tasks/${encodeURIComponent(taskId)}/bugs/${encodeURIComponent(bugId)}/resolve`, { method: 'POST', body: JSON.stringify({ resolution_summary: input.resolutionSummary, root_cause: input.rootCause, verification: input.verification }) }); }
  reopen(taskId: string, bugId: string): Promise<BugRecord> { return this.client.request(`/tasks/${encodeURIComponent(taskId)}/bugs/${encodeURIComponent(bugId)}/reopen`, { method: 'POST' }); }
  notes(taskId: string, bugId: string): Promise<BugNote[]> { return this.client.request(`/tasks/${encodeURIComponent(taskId)}/bugs/${encodeURIComponent(bugId)}/notes`); }
  addNote(taskId: string, bugId: string, input: { clientNoteId: string; text: string }): Promise<BugNote> { return this.client.request(`/tasks/${encodeURIComponent(taskId)}/bugs/${encodeURIComponent(bugId)}/notes`, { method: 'POST', body: JSON.stringify({ client_note_id: input.clientNoteId, text: input.text }) }); }
  resolutions(taskId: string, bugId: string): Promise<BugResolution[]> { return this.client.request(`/tasks/${encodeURIComponent(taskId)}/bugs/${encodeURIComponent(bugId)}/resolutions`); }
}

function toApiCreate(input: CreateBugInput): Record<string, unknown> {
  return { title: input.title, severity: input.severity, description: input.description, category: input.category, source: input.source, external_reference: input.externalReference, tags: input.tags, activate_immediately: input.activateImmediately };
}
