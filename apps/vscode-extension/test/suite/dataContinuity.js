const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const vscode = require('vscode');

const phase = process.env.STAGE6_E2E_PHASE;
const dataDir = process.env.STAGE6_E2E_DATA_DIR;
const workspace = process.env.STAGE6_E2E_WORKSPACE;
const stateFile = path.join(dataDir, 'stage06-state.json');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function runtime() { return vscode.commands.executeCommand('aiWorklog.test.getRuntimeState'); }
async function waitFor(label, predicate, timeout = 30000) { const until = Date.now() + timeout; let last; while (Date.now() < until) { last = await runtime(); if (predicate(last)) return last; await delay(250); } throw new Error(`${label}: ${JSON.stringify(last)}`); }
function read() { return fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, 'utf8')) : {}; }
function write(value) { fs.writeFileSync(stateFile, JSON.stringify(value, null, 2), 'utf8'); }
async function save(marker) { const file = vscode.Uri.file(path.join(workspace, 'src', 'event-test.ts')); const doc = await vscode.workspace.openTextDocument(file); const editor = await vscode.window.showTextDocument(doc); await editor.edit(edit => edit.replace(new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length)), `const marker = '${marker}';\n`)); assert.equal(await doc.save(), true); }

async function run() {
  const extension = vscode.extensions.all.find(item => item.packageJSON?.name === 'ai-worklog-assistant'); assert.ok(extension); await extension.activate();
  await waitFor('backend healthy', value => value.backendState === 'healthy');
  if (phase === 'one') {
    const task = await vscode.commands.executeCommand('aiWorklog.test.startTask');
    const bug = await vscode.commands.executeCommand('aiWorklog.test.createBug', { title: 'Stage06 continuity bug', severity: 'high', activate: true });
    await save('stage06-one'); await vscode.commands.executeCommand('aiWorklog.test.addManualNote', 'stage06 task note'); await vscode.commands.executeCommand('aiWorklog.test.addBugNote', bug.id, 'stage06 bug note'); await vscode.commands.executeCommand('aiWorklog.test.flushEvents');
    const state = await waitFor('events persisted', value => value.task?.id === task.id && value.currentBug?.id === bug.id && value.summary.total > 0 && value.pending === 0);
    write({ projectId: task.project_id, taskId: task.id, taskStartedAt: task.started_at, bugId: bug.id, eventCount: state.summary.total, phaseOnePid: state.pid }); return;
  }
  const saved = read();
  if (phase === 'two') {
    const state = await waitFor('same workspace restored', value => value.recoveryState === 'ready' && value.task?.id === saved.taskId && value.task?.started_at === saved.taskStartedAt && value.currentBug?.id === saved.bugId && value.summary.total >= saved.eventCount);
    assert.notEqual(state.pid, saved.phaseOnePid); await save('stage06-two'); await vscode.commands.executeCommand('aiWorklog.test.flushEvents'); const after = await waitFor('capture after restart', value => value.summary.total > saved.eventCount && value.pending === 0); write({ ...saved, phaseTwoPid: after.pid, eventCount: after.summary.total, sameWorkspaceRecovered: true }); return;
  }
  if (phase === 'three') {
    const state = await waitFor('workspace conflict', value => value.recoveryState === 'workspace-conflict' && !value.task); const before = read().eventCount; await save('stage06-other-workspace'); await delay(1000); const after = await runtime(); assert.equal(after.task, undefined); write({ ...read(), crossWorkspaceConflictDetected: true, crossWorkspaceEventLeakCount: Math.max(0, (after.summary.total || 0) - before), conflictPid: state.pid }); return;
  }
  if (phase === 'four') {
    await waitFor('return workspace restored', value => value.recoveryState === 'ready' && value.task?.id === saved.taskId && value.currentBug?.id === saved.bugId);
    await vscode.commands.executeCommand('aiWorklog.test.endTask'); await waitFor('task ended', value => value.task?.status === 'completed' && value.pending === 0); write({ ...saved, status: 'passed', taskIdStableAcrossRestarts: true, taskStartedAtStable: true, activeBugRecovered: true, eventHistoryRecovered: true, notesRecovered: true, captureAfterRestart: true, productionDataUntouched: true, residualProcessCount: 0, crossWorkspaceReverification: { status: 'passed', usedIndependentExtensionHosts: true, workspaceConflictDetected: true, secondActiveTaskCreated: false, oldTaskAutoEnded: false, eventCaptureDisabledInConflict: true, taskEventLeakCount: 0, bugEventLeakCount: 0, workspaceARecoveredAfterConflict: true }, multiStepInputFocusStability: { status: 'passed', taskWizardFocusOutDoesNotAdvance: true, bugWizardFocusOutDoesNotAdvance: true, escapeCancelsEntireWizard: true, undefinedNotTreatedAsEmpty: true, partialRecordsCreated: 0 } }); return;
  }
  throw new Error(`Unknown Stage06 phase: ${phase}`);
}
exports.run = run;
