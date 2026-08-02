import { WorklogEventType } from './apiClient';

/**
 * The bug selection is deliberately part of a buffered event, rather than a
 * value looked up while flushing.  A flush may happen after the user switches
 * or resolves a bug, but that must not change ownership of an earlier event.
 */
export interface BufferedEvent {
  client_event_id: string;
  event_type: WorklogEventType;
  source: 'vscode';
  taskId: string;
  bug_id?: string;
  [key: string]: unknown;
}
export class EventBuffer {
  private readonly items: BufferedEvent[] = [];
  private flushing?: Promise<void>;
  private timer?: ReturnType<typeof setInterval>;
  constructor(private readonly send: (taskId: string, events: BufferedEvent[]) => Promise<void>, private readonly max = 500, private readonly threshold = 50, intervalMs = 2000) { this.timer = setInterval(() => void this.flush(), intervalMs); }
  get size(): number { return this.items.length; }
  clear(): void { this.items.splice(0); }
  add(event: BufferedEvent): void { if (this.items.length >= this.max) this.items.shift(); this.items.push(event); if (this.items.length >= this.threshold) void this.flush(); }
  async flush(): Promise<void> { if (this.flushing || !this.items.length) return this.flushing || Promise.resolve(); const batch = this.items.splice(0, 100); this.flushing = (async () => { try { const grouped = new Map<string, BufferedEvent[]>(); for (const item of batch) grouped.set(item.taskId, [...(grouped.get(item.taskId) || []), item]); for (const [taskId, events] of grouped) await this.send(taskId, events); } catch { this.items.unshift(...batch); } finally { this.flushing = undefined; } })(); return this.flushing; }
  async dispose(): Promise<void> { if (this.timer) clearInterval(this.timer); await this.flush(); }
}
