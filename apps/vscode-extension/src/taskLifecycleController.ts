import { ApiClient, ApiError, ProjectView, TaskView } from './apiClient';
import { TaskState } from './taskState';

export function friendlyTaskError(error: unknown): string {
  if (!(error instanceof ApiError)) return error instanceof Error ? error.message : '请求失败';
  if (error.status === 409) return error.message || '已有活动任务，请先结束它';
  if (error.status === 401) return '会话已失效，请重启后端';
  if (error.status === 404) return '项目或任务不存在';
  if (error.category === 'protocol') return '后端响应格式无效，请重启后端';
  if (error.status === 0) return '后端不可用，请稍后重试';
  return error.message || '后端请求失败';
}

export class TaskLifecycleController {
  private projects: ProjectView[] = [];
  constructor(private readonly state: TaskState, private readonly notify: () => void, private readonly report: (message: string) => void) {}
  get availableProjects(): ProjectView[] { return [...this.projects]; }
  async synchronize(api: ApiClient): Promise<TaskView | null> { try { this.projects = await api.listProjects(); const active = await api.activeTask(); if (active) this.state.setTask(active); else this.state.clear(); this.notify(); return active; } catch (error) { this.report(friendlyTaskError(error)); throw error; } }
  async createProject(api: ApiClient, name: string, workspacePath?: string): Promise<ProjectView> { try { const project = await api.createProject({ name, workspace_path: workspacePath }); this.projects = await api.listProjects(); this.notify(); return project; } catch (error) { this.report(friendlyTaskError(error)); throw error; } }
  async start(api: ApiClient, input: { name: string; project_id: string; description?: string; requirement_id?: string; tags?: string[] }): Promise<TaskView> { try { const task = await api.createTask(input); this.state.setTask(task); this.notify(); return task; } catch (error) { this.report(friendlyTaskError(error)); throw error; } }
  async end(api: ApiClient): Promise<TaskView> { if (!this.state.task) throw new Error('当前没有活动任务'); try { const task = await api.endTask(this.state.task.id); this.state.setTask(task); this.notify(); return task; } catch (error) { this.report(friendlyTaskError(error)); throw error; } }
}
