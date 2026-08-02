import { BackendState } from './backendState';

export interface WorklogButtonState {
  startServer: boolean;
  restartServer: boolean;
  startTask: boolean;
  endTask: boolean;
  addNote: boolean;
  refresh: boolean;
  refreshEvents: boolean;
  showRecentEvents: boolean;
}

export function shouldApplyRender(renderVersion: number, currentVersion: number): boolean {
  return renderVersion === currentVersion;
}

export function buttonState(backendState: BackendState, activeTask: boolean, eventCount: number): WorklogButtonState {
  const healthy = backendState === 'healthy';
  return {
    startServer: healthy,
    restartServer: true,
    startTask: healthy && !activeTask,
    endTask: healthy && activeTask,
    addNote: healthy && activeTask,
    refresh: healthy,
    refreshEvents: healthy && activeTask,
    showRecentEvents: healthy && activeTask && eventCount > 0,
  };
}
