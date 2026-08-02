const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const vscode = require('vscode');

const reportPath = process.env.STAGE5_E2E_REPORT;
const workspacePath = process.env.STAGE5_E2E_WORKSPACE;
const dataDir = process.env.STAGE5_E2E_DATA_DIR;
const report = { status: 'failed', bugLifecycle: { bugACreated: false, bugBCreated: false, switchPassed: false, eventAssociationPassed: false, pendingEventAssociationPassed: false, notePersisted: false, resolved: false, reopened: false, restartRecoveryPassed: false, viewReopenPassed: false, taskEndAutoPausePassed: false } };
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function runtime() { return vscode.commands.executeCommand('aiWorklog.test.getRuntimeState'); }
async function waitFor(label, predicate, timeout = 30000) { const deadline = Date.now() + timeout; let last; while (Date.now() < deadline) { last = await predicate(); if (last) return last; await delay(250); } throw new Error(`${label} timed out: ${JSON.stringify(last)}`); }
async function waitRuntime(label, predicate) { return waitFor(label, async () => { const value = await runtime(); return predicate(value) ? value : false; }); }
async function saveText(document, text) { const editor = await vscode.window.showTextDocument(document); const range = new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)); await editor.edit(edit => edit.replace(range, text)); assert.equal(await document.save(), true); }
function sqliteCheck(dbPath, taskId, bugA, bugB) { const source = "import json,sqlite3,sys;c=sqlite3.connect(sys.argv[1]);t,a,b=sys.argv[2:];bugs=dict(c.execute('select id,status from bugs where task_id=?',(t,)).fetchall());events=c.execute('select bug_id from worklog_events where task_id=?',(t,)).fetchall();notes=c.execute('select count(*) from bug_notes where bug_id=?',(b,)).fetchone()[0];print(json.dumps({'bugs':bugs,'eventBugIds':[r[0] for r in events],'notes':notes}))"; const run = childProcess.spawnSync('python', ['-c', source, dbPath, taskId, bugA, bugB], { encoding: 'utf8', timeout: 15000 }); if (run.status) throw new Error(run.stderr); return JSON.parse(run.stdout); }

async function run() {
  try {
    const extension = vscode.extensions.all.find(item => item.packageJSON?.name === 'ai-worklog-assistant'); assert.ok(extension); await extension.activate();
    await waitRuntime('backend healthy', state => state.backendState === 'healthy');
    const task = await vscode.commands.executeCommand('aiWorklog.test.startTask'); assert.equal(task.status, 'active');
    const bugA = await vscode.commands.executeCommand('aiWorklog.test.createBug', { title: 'Stage5 Bug A', severity: 'high', activate: true }); report.bugLifecycle.bugACreated = true;
    await waitRuntime('Bug A active', state => state.currentBug?.id === bugA.id);
    await vscode.commands.executeCommand('aiWorklog.test.recordEvent', 'manual_note');
    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(path.join(workspacePath, 'src', 'event-test.ts')));
    await saveText(document, 'const stage5 = "A";\n');
    const bugB = await vscode.commands.executeCommand('aiWorklog.test.createBug', { title: 'Stage5 Bug B', severity: 'medium' }); report.bugLifecycle.bugBCreated = true;
    await vscode.commands.executeCommand('aiWorklog.test.activateBug', bugB.id);
    const switched = await waitRuntime('Bug B active', state => state.currentBug?.id === bugB.id && state.bugs.some(b => b.id === bugA.id && b.status === 'paused'));
    report.bugLifecycle.switchPassed = true;
    await vscode.commands.executeCommand('aiWorklog.test.recordEvent', 'manual_note');
    await saveText(document, 'const stage5 = "B";\n'); await vscode.commands.executeCommand('aiWorklog.test.flushEvents');
    await delay(1000); const associated = await runtime(); assert.ok((associated.recent.items || []).some(e => (e.bugId || e.bug_id) === bugA.id) && (associated.recent.items || []).some(e => (e.bugId || e.bug_id) === bugB.id), `event ids=${JSON.stringify((associated.recent.items || []).map(e => ({ type: e.eventType, bugId: e.bugId, bug_id: e.bug_id })))}`);
    report.bugLifecycle.eventAssociationPassed = true; report.bugLifecycle.pendingEventAssociationPassed = true;
    await vscode.commands.executeCommand('aiWorklog.test.addBugNote', bugB.id, 'Stage5 private note'); report.bugLifecycle.notePersisted = true;
    await vscode.commands.executeCommand('aiWorklog.test.resolveBug', bugB.id); await waitRuntime('Bug B resolved', state => !state.currentBug && state.bugs.some(b => b.id === bugB.id && b.status === 'resolved')); report.bugLifecycle.resolved = true;
    await vscode.commands.executeCommand('aiWorklog.test.reopenBug', bugB.id); await vscode.commands.executeCommand('aiWorklog.test.activateBug', bugB.id); await waitRuntime('Bug B reopened active', state => state.currentBug?.id === bugB.id); report.bugLifecycle.reopened = true;
    await vscode.commands.executeCommand('aiWorklog.test.restartBackend'); await waitRuntime('restart recovery', state => state.backendState === 'healthy' && state.task?.id === task.id && state.currentBug?.id === bugB.id); report.bugLifecycle.restartRecoveryPassed = true;
    const before = await runtime(); await vscode.commands.executeCommand('aiWorklog.sidebar.toggleVisibility'); await vscode.commands.executeCommand('aiWorklog.sidebar.focus'); await delay(300); await vscode.commands.executeCommand('aiWorklog.sidebar.toggleVisibility'); await delay(300); await vscode.commands.executeCommand('aiWorklog.sidebar.toggleVisibility'); const after = await waitRuntime('view reopen', state => state.currentBug?.id === bugB.id && state.pid === before.pid); report.bugLifecycle.viewReopenPassed = true;
    await vscode.commands.executeCommand('aiWorklog.test.endTask'); const ended = await waitRuntime('task end', state => state.task?.status === 'completed' && state.pending === 0); const db = sqliteCheck(path.join(dataDir, 'worklog.db'), task.id, bugA.id, bugB.id); assert.equal(db.bugs[bugB.id], 'paused'); assert.ok(db.notes > 0); assert.ok(db.eventBugIds.includes(bugA.id) && db.eventBugIds.includes(bugB.id)); report.bugLifecycle.taskEndAutoPausePassed = true;
    report.status = 'passed'; fs.mkdirSync(path.dirname(reportPath), { recursive: true }); fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');
  } catch (error) { fs.mkdirSync(path.dirname(reportPath), { recursive: true }); fs.writeFileSync(reportPath, JSON.stringify({ ...report, error: String(error) }, null, 2), 'utf8'); throw error; }
}
exports.run = run;
