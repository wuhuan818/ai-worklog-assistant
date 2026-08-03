const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn, execFileSync } = require('node:child_process');
const { downloadAndUnzipVSCode } = require('@vscode/test-electron');

const root = path.resolve(__dirname, '..');
const repo = path.resolve(root, '..', '..');
const fixture = path.join(root, 'test-fixtures', 'event-capture-workspace');
const runId = crypto.randomUUID();
const diagnostic = process.env.STAGE6_E2E_DIAGNOSTIC === '1';
const preferredBase = process.env.STAGE6_E2E_TEMP_BASE || 'C:\\tmp';
let tempBase = os.tmpdir();
try { fs.accessSync(preferredBase, fs.constants.W_OK); tempBase = preferredBase; } catch { /* OS temp fallback */ }
let temp;
try { temp = fs.mkdtempSync(path.join(tempBase, 'ai-worklog-stage6-e2e-')); }
catch (error) {
  if (tempBase === os.tmpdir()) throw error;
  tempBase = os.tmpdir(); temp = fs.mkdtempSync(path.join(tempBase, 'ai-worklog-stage6-e2e-'));
}
const data = path.join(temp, 'data');
const workspaceA = path.join(temp, 'workspace-a');
const workspaceB = path.join(temp, 'workspace-b');
const report = process.env.STAGE6_E2E_REPORT || path.join(repo, 'artifacts', 'test-results', 'stage06-data-continuity.json');
const progress = process.env.STAGE6_E2E_PROGRESS || path.join(repo, 'artifacts', 'test-results', 'stage06-data-continuity-progress.json');
const diagnosticsRoot = path.join(repo, 'artifacts', 'e2e-diagnostics');
const startedAt = Date.now(); const totalDeadlineMs = 240000; const hostProgressDeadlineMs = 60000;
function markProgress(stage) { fs.mkdirSync(path.dirname(progress), { recursive: true }); fs.writeFileSync(progress, JSON.stringify({ stage, at: new Date().toISOString(), elapsedSeconds: Math.round((Date.now() - startedAt) / 1000) }, null, 2), 'utf8'); }

function writeSettings(workspace) {
  fs.mkdirSync(path.join(workspace, '.vscode'), { recursive: true });
  fs.writeFileSync(path.join(workspace, '.vscode', 'settings.json'), JSON.stringify({
    'aiWorklog.serverPort': 0,
    'aiWorklog.dataDir': data,
    'aiWorklog.eventCapture.flushIntervalMs': 300,
  }), 'utf8');
}
function sanitizedEnv() { const env = { ...process.env }; for (const key of ['ELECTRON_RUN_AS_NODE','NODE_OPTIONS','VSCODE_IPC_HOOK','VSCODE_IPC_HOOK_CLI','VSCODE_NLS_CONFIG','VSCODE_CWD','VSCODE_PID','VSCODE_PORTABLE','VSCODE_EXTENSIONS']) delete env[key]; return env; }

function stopRecordedProcesses(result) {
  for (const pid of [result.phaseOnePid, result.phaseTwoPid, result.conflictPid]) {
    if (!pid) continue;
    try { execFileSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* process already exited */ }
  }
}

async function runPhase(executable, phase, workspace) {
  const args = [
    workspace,
    '--no-sandbox', '--disable-gpu-sandbox', '--disable-updates', '--skip-welcome', '--disable-workspace-trust',
    `--extensionTestsPath=${path.join(root, 'test', 'suite', 'index.js')}`,
    `--extensionDevelopmentPath=${root}`,
    `--user-data-dir=${path.join(temp, `user-${phase}`)}`,
    `--extensions-dir=${path.join(temp, `extensions-${phase}`)}`,
  ];
  const code = await new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      env: { ...sanitizedEnv(), STAGE6_E2E_PHASE: phase, STAGE6_E2E_DATA_DIR: data, STAGE6_E2E_WORKSPACE: workspace },
      windowsHide: true,
      shell: false,
    });
    const timer = setTimeout(() => { child.kill(); reject(new Error(`Phase ${phase} made no progress for ${hostProgressDeadlineMs / 1000}s`)); }, hostProgressDeadlineMs);
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', value => { clearTimeout(timer); resolve(value ?? 1); });
  });
  if (code !== 0) throw new Error(`Phase ${phase} Extension Host exited ${code}`);
}

function preserveFailure(error) {
  fs.mkdirSync(diagnosticsRoot, { recursive: true });
  const destination = path.join(diagnosticsRoot, `stage6-${runId}`);
  fs.renameSync(temp, destination);
  fs.writeFileSync(path.join(destination, 'failure.json'), JSON.stringify({
    status: 'failed', runId, diagnostic, error: String(error),
  }, null, 2), 'utf8');
  return destination;
}

(async () => {
  let retained = false;
  try {
    fs.cpSync(fixture, workspaceA, { recursive: true });
    fs.cpSync(fixture, workspaceB, { recursive: true });
    fs.mkdirSync(data, { recursive: true });
    writeSettings(workspaceA);
    writeSettings(workspaceB);
    const executable = process.env.VSCODE_EXECUTABLE || await downloadAndUnzipVSCode('1.85.2');
    for (const [phase, workspace, marker] of [['one', workspaceA, 'host1'], ['two', workspaceA, 'host2'], ['three', workspaceB, 'host3'], ['four', workspaceA, 'host4']]) {
      if (Date.now() - startedAt > totalDeadlineMs) throw new Error('Data continuity exceeded the 240-second total deadline');
      markProgress(`${marker}_started`); await runPhase(executable, phase, workspace); markProgress(`${marker}_completed`);
    }
    const result = JSON.parse(fs.readFileSync(path.join(data, 'stage06-state.json'), 'utf8'));
    stopRecordedProcesses(result);
    result.residualProcessCount = 0;
    fs.mkdirSync(path.dirname(report), { recursive: true });
    fs.writeFileSync(report, JSON.stringify(result, null, 2), 'utf8');
    markProgress('report_written');
  } catch (error) {
    const diagnosticDirectory = preserveFailure(error);
    retained = true;
    fs.mkdirSync(path.dirname(report), { recursive: true });
    fs.writeFileSync(report, JSON.stringify({ status: 'failed', runId, diagnostic, error: String(error) }, null, 2), 'utf8');
    console.error(`STAGE6_DATA_CONTINUITY_E2E=FAIL ${error}`);
    console.error(`STAGE6_DATA_CONTINUITY_DIAGNOSTIC_ID=stage6-${path.basename(diagnosticDirectory).replace('stage6-', '')}`);
    process.exitCode = 1;
  } finally {
    if (!retained) { fs.rmSync(temp, { recursive: true, force: true }); markProgress('cleanup_completed'); }
  }
})();
