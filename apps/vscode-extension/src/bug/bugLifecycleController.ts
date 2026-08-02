import { BugService } from './bugService';
import { BugState } from './bugState';
import { BugRecord, CreateBugInput, ResolveBugInput } from './types';

/** Serializes lifecycle actions, preventing double-clicks from producing stale local state. */
export class BugLifecycleController {
  private pending = false;
  constructor(private readonly state: BugState, private readonly service: BugService, private readonly notify: () => void, private readonly report: (message: string) => void) {}
  get isPending(): boolean { return this.pending; }
  async synchronize(taskId: string): Promise<BugRecord | null> { return this.run(async () => { const [list, current] = await Promise.all([this.service.list(taskId), this.service.current(taskId)]); this.state.restore(taskId, list.items, current); this.notify(); return current; }); }
  async create(taskId: string, input: CreateBugInput): Promise<BugRecord> { this.validateTitle(input.title); return this.run(async () => { const bug = await this.service.create(taskId, input); this.state.replace(bug); this.notify(); return bug; }); }
  async activate(taskId: string, bugId: string): Promise<BugRecord> { return this.run(async () => { const result = await this.service.activate(taskId, bugId); if (result.pausedBug) this.state.replace(result.pausedBug); this.state.setCurrent(result.activeBug); this.notify(); return result.activeBug; }); }
  async pause(taskId: string, bugId: string): Promise<BugRecord> { return this.run(async () => { const bug = await this.service.pause(taskId, bugId); this.state.replace(bug); this.notify(); return bug; }); }
  async resolve(taskId: string, bugId: string, input: ResolveBugInput): Promise<BugRecord> { this.validateResolution(input.resolutionSummary); return this.run(async () => { const bug = await this.service.resolve(taskId, bugId, input); this.state.replace(bug); this.notify(); return bug; }); }
  async reopen(taskId: string, bugId: string): Promise<BugRecord> { return this.run(async () => { const bug = await this.service.reopen(taskId, bugId); this.state.replace(bug); this.notify(); return bug; }); }
  async addNote(taskId: string, bugId: string, clientNoteId: string, text: string): Promise<void> { if (!text.trim()) throw new Error('Bug 备注不能为空'); if (text.length > 4000) throw new Error('Bug 备注不能超过 4000 个字符'); await this.run(async () => { await this.service.addNote(taskId, bugId, { clientNoteId, text }); this.notify(); }); }
  taskEnded(): void { this.state.clearCurrent(); this.notify(); }
  private async run<T>(action: () => Promise<T>): Promise<T> { if (this.pending) throw new Error('Bug 操作正在进行，请稍候'); this.pending = true; try { return await action(); } catch (error) { this.report(error instanceof Error ? error.message : 'Bug 操作失败'); throw error; } finally { this.pending = false; } }
  private validateTitle(title: string): void { if (!title.trim()) throw new Error('Bug 标题不能为空'); }
  private validateResolution(summary: string): void { if (!summary.trim()) throw new Error('解决方案摘要不能为空'); }
}
