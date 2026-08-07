import { ApiClient, AiGenerationJob, AiGenerationProfile, AiSummaryDraft, AiSummaryDraftContent, AiSummaryRevision, AiSummaryReview, ExportPreview, KnowledgeCandidate, Publication } from '../../apiClient';
import { isTerminalGenerationStatus } from './types';

export class GenerationClient {
  constructor(private readonly api: ApiClient, private readonly pollIntervalMs = 800, private readonly maxWaitMs = 125_000) {}
  create(contextId: string, profile: AiGenerationProfile, idempotencyKey: string): Promise<AiGenerationJob> { return this.api.createAiSummaryGeneration(contextId, profile, idempotencyKey); }
  get(jobId: string): Promise<AiGenerationJob> { return this.api.getAiGenerationJob(jobId); }
  cancel(jobId: string): Promise<AiGenerationJob> { return this.api.cancelAiGenerationJob(jobId); }
  drafts(taskId: string): Promise<AiSummaryDraft[]> { return this.api.listAiSummaryDrafts(taskId); }
  draft(draftId: string): Promise<AiSummaryDraft> { return this.api.getAiSummaryDraft(draftId); }
  revisions(draftId: string): Promise<AiSummaryRevision[]> { return this.api.listAiSummaryRevisions(draftId); }
  reviews(taskId: string): Promise<{ current: AiSummaryReview | null; history: AiSummaryReview[] }> { return this.api.getAiSummaryReviews(taskId); }
  saveRevision(taskId: string, draftId: string, content: AiSummaryDraftContent, key: string): Promise<AiSummaryRevision> { return this.api.saveAiSummaryRevision(taskId, draftId, content, key); }
  approve(taskId: string, draftId: string, revisionId: string): Promise<AiSummaryReview> { return this.api.approveAiSummaryRevision(taskId, draftId, revisionId); }
  reject(taskId: string, draftId: string, revisionId: string | undefined, reason: string): Promise<AiSummaryReview> { return this.api.rejectAiSummaryContent(taskId, draftId, revisionId, reason); }
  exportSummary(taskId: string): Promise<Publication> { return this.api.exportApprovedSummary(taskId); }
  exportDaily(taskId: string): Promise<Publication> { return this.api.exportApprovedDailyReport(taskId); }
  previewExport(taskId: string, kind: ExportPreview['kind']): Promise<ExportPreview> { return this.api.previewApprovedExport(taskId, kind); }
  candidates(taskId: string): Promise<KnowledgeCandidate[]> { return this.api.knowledgeCandidates(taskId); }
  publishKnowledge(taskId: string, items: KnowledgeCandidate[]): Promise<{ items: Publication[] }> { return this.api.publishKnowledge(taskId, items); }
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
