import { BackendState } from '../backendState';
import { BugState } from './bugState';

export interface BugButtonState { create: boolean; activate: boolean; pause: boolean; resolve: boolean; reopen: boolean; addNote: boolean; }
export interface BugViewModel { activeBugId?: string; counts: ReturnType<BugState['counts']>; elapsedSeconds: number; buttons: BugButtonState; }

export function bugViewModel(backend: BackendState, activeTask: boolean, state: BugState): BugViewModel {
  const healthy = backend === 'healthy'; const current = state.current;
  return { activeBugId: state.activeBugId, counts: state.counts(), elapsedSeconds: state.elapsedSeconds(), buttons: { create: healthy && activeTask, activate: healthy && activeTask, pause: healthy && activeTask && current?.status === 'active', resolve: healthy && activeTask && Boolean(current), reopen: healthy && activeTask, addNote: healthy && activeTask && Boolean(current) } };
}
