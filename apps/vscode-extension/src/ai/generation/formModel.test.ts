import test from 'node:test';
import assert from 'node:assert/strict';
import { contentToForm, evidenceLabel, formToContent } from './formModel';
import { AiSummaryDraftContent } from '../../apiClient';

const content: AiSummaryDraftContent = { schema_version: 'ai-summary-draft/v1', sections: { task_summary: { summary: 'done', outcomes: ['one'], evidence_refs: ['vscode_task_started:id'] }, code_changes: [{ path: 'src/a.ts', summary: 'change', impact: 'impact', evidence_refs: ['file_saved:id'] }], commands_and_results: [], bug_solutions: [], unresolved_issues: [], todos: [], daily_report: { title: 'daily', body: 'body', highlights: [], blockers: [], next_focus: [], evidence_refs: [] }, knowledge_candidates: [] } };
test('form conversion preserves evidence while business fields are editable', () => { const form = contentToForm(content); form.task_summary.summary = 'edited'; form.task_summary.outcomes.push('two'); const rebuilt = contentToForm(formToContent(form)); assert.equal(rebuilt.task_summary.summary, 'edited'); assert.deepEqual(rebuilt.task_summary.refs, ['vscode_task_started:id']); assert.deepEqual(rebuilt.code_changes[0].refs, ['file_saved:id']); assert.equal(contentToForm(content).task_summary.summary, 'done'); });
test('evidence references receive friendly labels', () => assert.equal(evidenceLabel('vscode_task_ended:any'), '任务结束事件'));
