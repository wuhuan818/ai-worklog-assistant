import { TaskView } from './apiClient';

export class TaskState {
  private current?: TaskView;
  private readonly listeners = new Set<() => void>();
  get task(): TaskView | undefined { return this.current; }
  setTask(task: TaskView): void { this.current = { ...task, tags: Array.isArray(task.tags) ? task.tags : [] }; this.emit(); }
  clear(): void { this.current = undefined; this.emit(); }
  onDidChange(listener: () => void): { dispose(): void } { this.listeners.add(listener); return { dispose: () => this.listeners.delete(listener) }; }
  isRecording(): boolean { return this.current?.status === 'active'; }
  elapsedSeconds(now = Date.now()): number { return this.current ? Math.max(0, Math.floor((now - Date.parse(this.current.started_at)) / 1000)) : 0; }
  static formatDuration(seconds: number): string { const hours = Math.floor(seconds / 3600); const minutes = Math.floor((seconds % 3600) / 60); const remainder = seconds % 60; return `${hours}小时${minutes}分${remainder}秒`; }
  label(): string { return this.current ? `${this.current.name} (${this.current.status})` : '暂无活动任务'; }
  private emit(): void { for (const listener of this.listeners) listener(); }
}
