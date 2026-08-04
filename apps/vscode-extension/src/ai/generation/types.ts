import { AiGenerationJob, AiGenerationStatus, AiSummaryDraft } from '../../apiClient';

export type GenerationStatus = AiGenerationStatus;
export type GenerationJob = AiGenerationJob;
export type SummaryDraft = AiSummaryDraft;
export const terminalGenerationStatuses: ReadonlySet<GenerationStatus> = new Set(['succeeded', 'failed', 'cancelled', 'interrupted']);
export const isTerminalGenerationStatus = (status: GenerationStatus): boolean => terminalGenerationStatuses.has(status);
export const generationStatusLabel = (status: GenerationStatus): string => ({ queued: 'Queued', running: 'Generating', validating: 'Validating', succeeded: 'Completed', failed: 'Failed', cancelled: 'Cancelled', interrupted: 'Interrupted' }[status]);
