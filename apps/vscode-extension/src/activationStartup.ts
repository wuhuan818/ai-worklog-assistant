import { BackendState } from './backendState';

export interface ActivationBackend {
  readonly state: BackendState;
  start(): Promise<unknown>;
}

export interface ActivationStartupLogger {
  appendLine(value: string): void;
}

export async function startBackendOnActivation(backend: ActivationBackend, logger: ActivationStartupLogger): Promise<void> {
  logger.appendLine('[backend-auto-start] requested');
  if (backend.state === 'healthy' || backend.state === 'starting') {
    logger.appendLine(`[backend-auto-start] current state=${backend.state}; no duplicate start`);
    return;
  }
  logger.appendLine(`[backend-auto-start] current state=${backend.state}`);
  logger.appendLine('[backend-auto-start] starting');
  try {
    await backend.start();
    logger.appendLine('[backend-auto-start] healthy');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.appendLine(`[backend-auto-start-error] ${message.slice(0, 500)}`);
  }
}
