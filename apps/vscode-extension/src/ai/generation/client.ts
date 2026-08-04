import { ApiClient, AiGenerationJob, AiGenerationProfile, AiSummaryDraft } from '../../apiClient';
import { isTerminalGenerationStatus } from './types';

export class GenerationClient {
  constructor(private readonly api: ApiClient, private readonly pollIntervalMs = 800, private readonly maxWaitMs = 125_000) {}
  create(contextId: string, profile: AiGenerationProfile, idempotencyKey: string): Promise<AiGenerationJob> { return this.api.createAiSummaryGeneration(contextId, profile, idempotencyKey); }
  get(jobId: string): Promise<AiGenerationJob> { return this.api.getAiGenerationJob(jobId); }
  cancel(jobId: string): Promise<AiGenerationJob> { return this.api.cancelAiGenerationJob(jobId); }
  drafts(taskId: string): Promise<AiSummaryDraft[]> { return this.api.listAiSummaryDrafts(taskId); }
  draft(draftId: string): Promise<AiSummaryDraft> { return this.api.getAiSummaryDraft(draftId); }
  async wait(jobId: string, onUpdate?: (job: AiGenerationJob) => void, signal?: AbortSignal): Promise<AiGenerationJob> {
    const deadline = Date.now() + this.maxWaitMs;
    for (;;) {
      if (signal?.aborted) throw new Error('Generation wait cancelled');
      if (Date.now() >= deadline) throw new Error('Generation status polling timed out');
      const job = await this.get(jobId); onUpdate?.(job);
      if (isTerminalGenerationStatus(job.status)) return job;
      const delay = Math.min(this.pollIntervalMs, Math.max(0, deadline - Date.now()));
      await new Promise<void>((resolve, reject) => { const timer = setTimeout(resolve, delay); signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new Error('Generation wait cancelled')); }, { once: true }); });
    }
  }
}
