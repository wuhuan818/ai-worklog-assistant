import { CodeDiff, createSaveDiff } from './codeDiff';

export type SaveCapture =
  | { kind: 'baseline' }
  | { kind: 'unchanged' }
  | { kind: 'diff'; diff: CodeDiff };

/** Holds only in-memory snapshots for the active task and never persists file bodies. */
export class SaveDiffTracker {
  private readonly baselines = new Map<string, string>();

  prime(key: string, text: string): void { this.baselines.set(key, text); }

  capture(key: string, text: string, filePath: string, maxBytes: number): SaveCapture {
    const previous = this.baselines.get(key);
    this.baselines.set(key, text);
    if (previous === undefined) return { kind: 'baseline' };
    const diff = createSaveDiff(previous, text, filePath, maxBytes);
    return diff ? { kind: 'diff', diff } : { kind: 'unchanged' };
  }

  delete(key: string): void { this.baselines.delete(key); }
  clear(): void { this.baselines.clear(); }
}
