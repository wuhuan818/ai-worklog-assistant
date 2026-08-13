import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiError, ProjectView, TaskView } from './apiClient';
import { TaskLifecycleController } from './taskLifecycleController';
import { TaskState } from './taskState';

const project: ProjectView = { id: 'p1', user_id: 'local-user', name: 'Demo', created_at: '', updated_at: '' };
const api = (active: TaskView | null, error?: unknown) => ({
  listProjects: async () => [project],
  activeTask: async () => { if (error) throw error; return active; },
}) as never;

test('empty active task synchronizes to clear state without reporting an error', async () => {
  const state = new TaskState();
  state.setTask({ id: 'old', project_id: 'p1', name: 'Old', status: 'active', started_at: new Date().toISOString(), tags: [] });
  const reports: string[] = [];
  const controller = new TaskLifecycleController(state, () => undefined, message => reports.push(message));
  await controller.synchronize(api(null));
  assert.equal(state.task, undefined);
  assert.deepEqual(reports, []);
});

test('real API errors still report and reject synchronization', async () => {
  const reports: string[] = [];
  const controller = new TaskLifecycleController(new TaskState(), () => undefined, message => reports.push(message));
  await assert.rejects(() => controller.synchronize(api(null, new ApiError(500, 'server error'))));
  assert.deepEqual(reports, ['server error']);
});

test('ambiguous end failure reconciles a remotely completed Task', async () => {
  const state = new TaskState();
  state.setTask({ id: 'task-1', project_id: 'p1', name: 'Active', status: 'active', started_at: '', tags: [] });
  let notifications = 0;
  const controller = new TaskLifecycleController(state, () => { notifications += 1; }, () => undefined);
  const completed = { id: 'task-1', project_id: 'p1', name: 'Active', status: 'completed', started_at: '', ended_at: '', duration_seconds: 1, tags: [] };
  const reconciled = await controller.reconcileCompletedTask({ getTask: async () => completed } as never, 'task-1');
  assert.equal(reconciled?.status, 'completed');
  assert.equal(state.task?.status, 'completed');
  assert.equal(notifications, 1);
});

test('ambiguous end failure does not treat a still-active Task as completed', async () => {
  const state = new TaskState();
  const active = { id: 'task-1', project_id: 'p1', name: 'Active', status: 'active', started_at: '', tags: [] };
  state.setTask(active);
  const controller = new TaskLifecycleController(state, () => undefined, () => undefined);
  assert.equal(await controller.reconcileCompletedTask({ getTask: async () => active } as never, 'task-1'), null);
  assert.equal(state.task?.status, 'active');
});
