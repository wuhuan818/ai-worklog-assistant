import { AiSummaryDraftContent } from '../../apiClient';

export type Evidence = { refs: string[] };
export type TaskSummaryForm = Evidence & { summary: string; outcomes: string[] };
export type CodeChangeForm = Evidence & { path: string; summary: string; impact: string };
export type CommandForm = Evidence & { command: string; result: string; status: 'succeeded' | 'failed' | 'unknown' };
export type BugForm = Evidence & { bug_ref: string; problem: string; solution: string; verification: string };
export type IssueForm = Evidence & { issue: string; impact: string; next_step: string };
export type TodoForm = Evidence & { item: string; priority: 'high' | 'medium' | 'low'; rationale: string };
export type DailyReportForm = Evidence & { title: string; body: string; highlights: string[]; blockers: string[]; next_focus: string[] };
export type KnowledgeForm = Evidence & { title: string; category: string; summary: string; why_reusable: string };
export interface SummaryFormState { task_summary: TaskSummaryForm; code_changes: CodeChangeForm[]; commands_and_results: CommandForm[]; bug_solutions: BugForm[]; unresolved_issues: IssueForm[]; todos: TodoForm[]; daily_report: DailyReportForm; knowledge_candidates: KnowledgeForm[]; }

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const toFormEvidence = <T>(value: T): T & Evidence => { const copy = clone(value) as T & Evidence & { evidence_refs?: string[] }; copy.refs = copy.evidence_refs || []; delete (copy as { evidence_refs?: string[] }).evidence_refs; return copy; };
const toDtoEvidence = <T extends Evidence>(value: T): Omit<T, 'refs'> & { evidence_refs: string[] } => { const copy = clone(value) as T & { evidence_refs?: string[] }; copy.evidence_refs = copy.refs; delete (copy as Partial<Evidence>).refs; return copy as Omit<T, 'refs'> & { evidence_refs: string[] }; };
const missingCodePath = (value: unknown): boolean => typeof value !== 'string' || !value.trim() || /^<?unknown>?$/i.test(value.trim());
export function evidencePathsFromContext(context: Record<string, unknown>): Record<string, string> {
  const paths: Record<string, string> = {};
  const diffs = Array.isArray(context.code_diffs) ? context.code_diffs : [];
  for (const value of diffs) {
    if (!value || typeof value !== 'object') continue;
    const item = value as Record<string, unknown>;
    if (typeof item.id === 'string' && typeof item.path === 'string' && item.path.trim()) paths[`code_diff:${item.id}`] = item.path;
  }
  return paths;
}
export function contentToForm(content: AiSummaryDraftContent, evidencePaths: Readonly<Record<string, string>> = {}): SummaryFormState {
  const s = content.sections;
  const codeChanges = (s.code_changes as CodeChangeForm[]).map(value => {
    const item = toFormEvidence(value) as CodeChangeForm;
    if (missingCodePath(item.path)) {
      const candidates = [...new Set(item.refs.map(ref => evidencePaths[ref]).filter((path): path is string => Boolean(path)))];
      if (candidates.length === 1) item.path = candidates[0];
    }
    return item;
  });
  return { task_summary: toFormEvidence(s.task_summary) as TaskSummaryForm, code_changes: codeChanges, commands_and_results: (s.commands_and_results as CommandForm[]).map(value => toFormEvidence(value) as CommandForm), bug_solutions: (s.bug_solutions as BugForm[]).map(value => toFormEvidence(value) as BugForm), unresolved_issues: (s.unresolved_issues as IssueForm[]).map(value => toFormEvidence(value) as IssueForm), todos: (s.todos as TodoForm[]).map(value => toFormEvidence(value) as TodoForm), daily_report: toFormEvidence(s.daily_report) as DailyReportForm, knowledge_candidates: (s.knowledge_candidates as KnowledgeForm[]).map(value => toFormEvidence(value) as KnowledgeForm) };
}
export function formToContent(form: SummaryFormState): AiSummaryDraftContent {
  return { schema_version: 'ai-summary-draft/v1', sections: { task_summary: toDtoEvidence(form.task_summary), code_changes: form.code_changes.map(toDtoEvidence), commands_and_results: form.commands_and_results.map(toDtoEvidence), bug_solutions: form.bug_solutions.map(toDtoEvidence), unresolved_issues: form.unresolved_issues.map(toDtoEvidence), todos: form.todos.map(toDtoEvidence), daily_report: toDtoEvidence(form.daily_report), knowledge_candidates: form.knowledge_candidates.map(toDtoEvidence) } };
}
export function evidenceLabel(ref: string): string {
  const type = ref.split(':', 1)[0];
  return ({ vscode_task_started: '任务开始事件', vscode_task_ended: '任务结束事件', file_changed: '文件变更', file_saved: '文件保存', code_diff: '代码差异', terminal_command: '终端命令', diagnostics_changed: '诊断变更', manual_note: '手工备注' } as Record<string, string>)[type] || '工作记录证据';
}
