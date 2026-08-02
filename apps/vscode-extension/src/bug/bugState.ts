import { BugRecord, BugStatus, normalizeBug } from './types';

export class BugState {
  private selected?: BugRecord;
  private bugs: BugRecord[] = [];
  private taskId?: string;
  private timer?: ReturnType<typeof setInterval>;
  private readonly listeners = new Set<() => void>();
  get current(): BugRecord | undefined { return this.selected ? normalizeBug(this.selected) : undefined; }
  get all(): BugRecord[] { return this.bugs.map(normalizeBug); }
  get activeBugId(): string | undefined { return this.selected?.status === 'active' ? this.selected.id : undefined; }
  forTask(taskId: string): void { if (this.taskId !== taskId) { this.taskId = taskId; this.selected = undefined; this.bugs = []; this.emit(); } }
  restore(taskId: string, bugs: BugRecord[], current: BugRecord | null): void { this.taskId = taskId; this.bugs = bugs.map(normalizeBug); this.selected = current ? normalizeBug(current) : undefined; this.emit(); }
  replace(record: BugRecord): void { const next = normalizeBug(record); this.bugs = [...this.bugs.filter(item => item.id !== next.id), next]; this.selected = next.status === 'active' ? next : this.selected?.id === next.id ? undefined : this.selected; this.emit(); }
  setCurrent(record: BugRecord): void { this.replace({ ...record, status: 'active' }); }
  clearCurrent(): void { if (!this.selected) return; this.selected = undefined; this.emit(); }
  clear(): void { this.taskId = undefined; this.selected = undefined; this.bugs = []; this.emit(); }
  counts(): Record<BugStatus, number> { const result: Record<BugStatus, number> = { open: 0, active: 0, paused: 0, resolved: 0 }; for (const bug of this.bugs) result[bug.status]++; return result; }
  elapsedSeconds(now = Date.now()): number { if (!this.selected?.activatedAt) return this.selected?.totalActiveSeconds || 0; return this.selected.totalActiveSeconds + Math.max(0, Math.floor((now - Date.parse(this.selected.activatedAt)) / 1000)); }
  onDidChange(listener: () => void): { dispose(): void } { this.listeners.add(listener); return { dispose: () => this.listeners.delete(listener) }; }
  startTimer(intervalMs = 1000): void { if (!this.timer) this.timer = setInterval(() => { if (this.activeBugId) this.emit(); }, intervalMs); }
  dispose(): void { if (this.timer) clearInterval(this.timer); this.timer = undefined; this.listeners.clear(); }
  private emit(): void { for (const listener of this.listeners) listener(); }
}
