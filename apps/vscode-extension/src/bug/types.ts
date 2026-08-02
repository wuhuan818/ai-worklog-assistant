export type BugStatus = 'open' | 'active' | 'paused' | 'resolved';
export type BugSeverity = 'low' | 'medium' | 'high' | 'critical';

export interface BugRecord {
  id: string;
  userId: string;
  projectId: string;
  taskId: string;
  title: string;
  description?: string | null;
  severity: BugSeverity;
  category?: string | null;
  source?: string | null;
  externalReference?: string | null;
  tags: string[];
  status: BugStatus;
  createdAt: string;
  updatedAt: string;
  activatedAt?: string | null;
  pausedAt?: string | null;
  resolvedAt?: string | null;
  reopenedAt?: string | null;
  totalActiveSeconds: number;
}

export interface BugNote { id: string; clientNoteId: string; userId: string; taskId: string; bugId: string; text: string; createdAt: string; }
export interface BugResolution { id: string; userId: string; taskId: string; bugId: string; resolutionSummary: string; rootCause?: string | null; verification?: string | null; createdAt: string; }
export interface BugList { items: BugRecord[]; total: number; limit: number; offset: number; }
export interface ActivateBugResult { activeBug: BugRecord; pausedBug: BugRecord | null; }
export interface CreateBugInput { title: string; severity: BugSeverity; description?: string; category?: string; source?: string; externalReference?: string; tags?: string[]; activateImmediately?: boolean; }
export interface ResolveBugInput { resolutionSummary: string; rootCause?: string; verification?: string; }

export function normalizeBug(record: BugRecord): BugRecord {
  return { ...record, tags: Array.isArray(record.tags) ? [...record.tags] : [], totalActiveSeconds: Number.isFinite(record.totalActiveSeconds) ? record.totalActiveSeconds : 0 };
}
