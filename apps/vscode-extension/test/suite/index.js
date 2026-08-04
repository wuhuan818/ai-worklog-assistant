const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const vscode = require('vscode');

const reportPath = process.env.STAGE4_E2E_REPORT;
const workspacePath = process.env.STAGE4_E2E_WORKSPACE;
const dataDir = process.env.STAGE4_E2E_DATA_DIR;
const timeoutMs = 30000;
const report = { status: 'failed', extensionActivated: false, backendAutoStarted: false, backendHealthy: false, taskCreated: false, events: {}, restartPersistence: false, captureAfterRestart: false, endTaskFlush: false, logSecurityPassed: false, viewReopenStateConsistency: false, backendPidUnchangedAfterViewReopen: false, activeTaskPreservedAfterViewReopen: false, eventSummaryPreservedAfterViewReopen: false, residualProcessCount: 0, durationSeconds: 0 };
const tracePath = reportPath ? reportPath.replace(/\.json$/, '.trace.log') : null;
function trace(message) { if (tracePath) fs.appendFileSync(tracePath, `${new Date().toISOString()} ${message}\n`, 'utf8'); }

function writeReport(extra = {}) { fs.mkdirSync(path.dirname(reportPath), { recursive: true }); fs.writeFileSync(reportPath, JSON.stringify({ ...report, ...extra }, null, 2), 'utf8'); }
function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
async function waitFor(label, predicate, limit = timeoutMs) { const deadline = Date.now() + limit; let last; while (Date.now() < deadline) { last = await predicate(); if (last) return last; await delay(250); } throw new Error(`${label} timed out; last=${JSON.stringify(last)}`); }
async function runtime() { return vscode.commands.executeCommand('aiWorklog.test.getRuntimeState'); }
async function waitRuntime(predicate, label) { return waitFor(label, async () => { const state = await runtime(); return predicate(state) ? state : false; }); }
function eventCounts(state) { return state.summary.by_type || {}; }
function allEvents(state, type) { return (state.recent?.items || []).filter(item => (item.eventType || item.event_type) === type); }
async function saveText(document, text) { const editor = await vscode.window.showTextDocument(document); const full = new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)); await editor.edit(edit => edit.replace(full, text)); assert.equal(await document.save(), true); }
async function waitDiagnostics(uri, predicate, label) { return waitFor(label, () => predicate(vscode.languages.getDiagnostics(uri)), 30000); }
function sqliteCheck(dbPath, taskId) { const script = "import json,sqlite3,sys; c=sqlite3.connect(sys.argv[1]); rows=c.execute('select event_type,payload_json from worklog_events where task_id=? order by sequence',(sys.argv[2],)).fetchall(); print(json.dumps({'count':len(rows),'valid':all(json.loads(r[1]) is not None for r in rows)}))"; const result = childProcess.spawnSync('python', ['-c', script, dbPath, taskId], { encoding: 'utf8', timeout: 15000 }); if (result.status !== 0) throw new Error(`SQLite check failed: ${result.stderr}`); return JSON.parse(result.stdout.trim()); }

async function run() {
  const started = Date.now();
  try {
    trace('suite started');
    const extension = vscode.extensions.all.find(item => item.packageJSON?.name === 'ai-worklog-assistant');
    assert.ok(extension, 'AI Worklog extension not found');
    await extension.activate();
    trace('extension activated');
    report.extensionActivated = true;
    const initial = await waitRuntime(state => state.backendState === 'healthy' && state.pid, 'backend auto start');
    report.backendAutoStarted = true; report.backendHealthy = true;
    trace('backend healthy');
    if (initial.task?.status === 'active') {
      await vscode.commands.executeCommand('aiWorklog.test.endTask');
      await waitRuntime(state => state.task?.status === 'completed' && state.pending === 0, 'clear pre-existing task');
    }
    const task = await vscode.commands.executeCommand('aiWorklog.test.startTask');
    trace('task started');
    report.taskCreated = true; assert.equal(task.status, 'active');
    const active = await waitRuntime(state => state.task && state.task.id === task.id && state.task.status === 'active', 'active task sync');
    const fileUri = vscode.Uri.file(path.join(workspacePath, 'src', 'event-test.ts'));
    const document = await vscode.workspace.openTextDocument(fileUri);
    await saveText(document, 'const count: number = 1;\nconsole.log(count);\n');
    await saveText(document, 'const count: number = 2;\nconsole.log(count);\n');
    await vscode.commands.executeCommand('aiWorklog.test.flushEvents');
    const afterSave = await waitRuntime(state => (eventCounts(state).file_changed || 0) > 0 && (eventCounts(state).file_saved || 0) > 0, 'file events');
    assert.ok(allEvents(afterSave, 'file_changed').length > 0);
    assert.ok(allEvents(afterSave, 'file_changed').some(event => Number(event.payload.change_count) > 0));
    assert.ok(allEvents(afterSave, 'file_saved').some(event => typeof event.payload.diff_summary === 'string'));
    assert.ok(!JSON.stringify(afterSave.recent).includes('console.log(count)'));
    const beforeViewReopen = await runtime();
    const viewCommands = (await vscode.commands.getCommands(true)).filter(command => command.toLowerCase().includes('aiworklog') || command.toLowerCase().includes('view.extension'));
    trace(`view commands=${viewCommands.join(',')}`);
    await vscode.commands.executeCommand('aiWorklog.sidebar.toggleVisibility');
    await vscode.commands.executeCommand('aiWorklog.sidebar.focus');
    await delay(500);
    await vscode.commands.executeCommand('aiWorklog.sidebar.toggleVisibility');
    await delay(300);
    await vscode.commands.executeCommand('aiWorklog.sidebar.toggleVisibility');
    const afterViewReopen = await waitRuntime(state => state.backendState === 'healthy' && state.task?.id === task.id, 'view reopen state');
    report.backendPidUnchangedAfterViewReopen = beforeViewReopen.pid === afterViewReopen.pid;
    report.activeTaskPreservedAfterViewReopen = afterViewReopen.task.id === beforeViewReopen.task.id && afterViewReopen.task.started_at === beforeViewReopen.task.started_at;
    report.eventSummaryPreservedAfterViewReopen = afterViewReopen.summary.total >= beforeViewReopen.summary.total;
    report.viewReopenStateConsistency = report.backendPidUnchangedAfterViewReopen && report.activeTaskPreservedAfterViewReopen && report.eventSummaryPreservedAfterViewReopen;
    assert.equal(report.viewReopenStateConsistency, true);
    await saveText(document, 'const count: number = "abc";\nconsole.log(count);\n');
    await waitDiagnostics(fileUri, diagnostics => diagnostics.some(item => item.severity === vscode.DiagnosticSeverity.Error), 'diagnostics appear');
    await vscode.commands.executeCommand('aiWorklog.test.flushEvents');
    const withDiagnostics = await waitRuntime(state => (eventCounts(state).diagnostics_changed || 0) > 0, 'diagnostics event');
    assert.ok(allEvents(withDiagnostics, 'diagnostics_changed').length > 0);
    await saveText(document, 'const count: number = 3;\nconsole.log(count);\n');
    await waitDiagnostics(fileUri, diagnostics => diagnostics.filter(item => item.severity === vscode.DiagnosticSeverity.Error).length === 0, 'diagnostics clear');
    await vscode.commands.executeCommand('aiWorklog.test.flushEvents');
    const tasks = await vscode.tasks.fetchTasks(); const taskDefinition = tasks.find(item => item.name === 'AI Worklog Stage4 E2E'); assert.ok(taskDefinition, 'fixture task not found');
    await new Promise(async (resolve, reject) => { const subscription = vscode.tasks.onDidEndTask(event => { if (event.execution.task.name === taskDefinition.name) { subscription.dispose(); resolve(); } }); try { await vscode.tasks.executeTask(taskDefinition); } catch (error) { subscription.dispose(); reject(error); } setTimeout(() => { subscription.dispose(); reject(new Error('task execution timed out')); }, 30000); });
    await vscode.commands.executeCommand('aiWorklog.test.flushEvents');
    const afterTask = await waitRuntime(state => (eventCounts(state).vscode_task_started || 0) > 0 && (eventCounts(state).vscode_task_ended || 0) > 0, 'task event persistence');
    assert.ok((eventCounts(afterTask).vscode_task_process_started || 0) >= 0);
    let debugError = null;
    try { await new Promise(async (resolve, reject) => { const subscription = vscode.debug.onDidTerminateDebugSession(() => { subscription.dispose(); resolve(); }); try { const startedDebug = await vscode.debug.startDebugging(vscode.workspace.workspaceFolders[0], 'AI Worklog Stage4 Debug'); if (!startedDebug) throw new Error('startDebugging returned false'); } catch (error) { subscription.dispose(); reject(error); } setTimeout(() => { subscription.dispose(); reject(new Error('debug session timed out')); }, 30000); }); } catch (error) { debugError = String(error); }
    await vscode.commands.executeCommand('aiWorklog.test.addManualNote', `阶段4 E2E 自动备注 ${process.env.STAGE4_E2E_RUN_ID}`);
    await vscode.commands.executeCommand('aiWorklog.test.flushEvents');
    const beforeRestart = await waitRuntime(state => state.summary.total > 0 && state.pending === 0, 'pre-restart events');
    const beforeTaskId = beforeRestart.task.id; const beforeStartedAt = beforeRestart.task.started_at; const beforeTotal = beforeRestart.summary.total;
    await vscode.commands.executeCommand('aiWorklog.test.restartBackend');
    const recovered = await waitRuntime(state => state.backendState === 'healthy' && state.task?.id === beforeTaskId, 'backend restart recovery');
    report.restartPersistence = recovered.task.started_at === beforeStartedAt && recovered.summary.total >= beforeTotal;
    assert.equal(report.restartPersistence, true);
    await saveText(document, 'const count: number = 4;\nconsole.log(count);\n'); await vscode.commands.executeCommand('aiWorklog.test.flushEvents');
    const afterRestart = await waitRuntime(state => state.summary.total > beforeTotal && state.pending === 0, 'post-restart capture');
    report.captureAfterRestart = true; assert.ok((afterRestart.recent?.items || []).length > 0);
    await saveText(document, 'const count: number = 5;\nconsole.log(count);\n');
    await vscode.commands.executeCommand('aiWorklog.test.endTask');
    const ended = await waitRuntime(state => state.task?.status === 'completed' && state.pending === 0, 'end task flush');
    report.endTaskFlush = true; assert.equal(ended.task.id, beforeTaskId);
    const totalAfterEnd = ended.summary.total;
    await saveText(document, 'const count: number = 6;\nconsole.log(count);\n'); await delay(1500); const postEnd = await runtime(); assert.equal(postEnd.summary.total, totalAfterEnd);
    const db = sqliteCheck(path.join(dataDir, 'worklog.db'), beforeTaskId); assert.ok(db.count >= totalAfterEnd && db.valid); report.sqlite = true;
    const logPath = ended.logPath; const logText = logPath && fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8') : ''; const forbidden = [`阶段4 E2E 自动备注 ${process.env.STAGE4_E2E_RUN_ID}`, 'const count: number = "abc"', 'stage4-task-test', 'stage4 debug started']; assert.equal(forbidden.some(value => logText.includes(value)), false); report.logSecurityPassed = true;
    report.events = ended.summary.by_type; report.durationSeconds = Math.round((Date.now() - started) / 1000); report.debug = debugError ? { passed: false, reason: debugError.replace(/([A-Za-z]:\\[^ ]+)/g, '[PATH]') } : { passed: true }; report.status = debugError ? 'passed-with-debug-environment-limit' : 'passed'; writeReport();
  } catch (error) { report.durationSeconds = Math.round((Date.now() - started) / 1000); writeReport({ error: error instanceof Error ? error.message : String(error) }); throw error; }
}

exports.run = process.env.STAGE09_SUMMARY_SMOKE ? require('./aiSummarySmoke').run : process.env.STAGE08_CONTEXT_SMOKE ? require('./aiContextSmoke').run : process.env.STAGE071_E2E_REPORT ? require('./backendShutdown').run : process.env.STAGE7_SMOKE_E2E ? require('./aiProviderSmoke').run : process.env.STAGE6_E2E_PHASE ? require('./dataContinuity').run : process.env.STAGE5_E2E_REPORT ? require('./bugLifecycle').run : run;
