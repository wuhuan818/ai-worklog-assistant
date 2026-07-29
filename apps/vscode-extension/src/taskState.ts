import { TaskView } from './apiClient';

export class TaskState {
  private current?: TaskView;
  get task(): TaskView | undefined { return this.current; }
  setTask(task: TaskView): void { this.current = { ...task, tags: Array.isArray(task.tags) ? task.tags : [] }; }
  clear(): void { this.current = undefined; }
  isRecording(): boolean { return this.current?.status === 'active'; }
  label(): string { return this.current ? `${this.current.name} (${this.current.status})` : '暂无活动任务'; }
}
