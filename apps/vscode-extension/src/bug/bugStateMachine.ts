import { BugStatus } from './types';

const allowed: Record<BugStatus, readonly BugStatus[]> = {
  open: ['active', 'resolved'], active: ['paused', 'resolved'], paused: ['active', 'resolved'], resolved: ['open'],
};

export function canTransitionBug(from: BugStatus, to: BugStatus): boolean { return allowed[from].includes(to); }
export function assertBugTransition(from: BugStatus, to: BugStatus): void {
  if (!canTransitionBug(from, to)) throw new Error(`不允许的 Bug 状态转换：${from} → ${to}`);
}
