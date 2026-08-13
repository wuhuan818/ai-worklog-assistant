const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { isolatedEnvironment, ownedChildPid, terminateOwnedProcessTree, waitForProcessesToExit } = require('./vscodeTestLauncher');

const extensionRoot = path.resolve(__dirname, '..');
const fixture = path.join(extensionRoot, 'test-fixtures', 'event-capture-workspace');
const repoRoot = path.resolve(extensionRoot, '..', '..');
const expectedVscodeVersion = process.env.STAGE4_E2E_EXPECTED_VSCODE_VERSION || '1.93.1';
const hardTimeoutMs = 300000;
const downloadTimeoutMs = 180000;

function errorMessage(error) { return error instanceof Error ? error.message : String(error); }
function readJson(file) {
  try { return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null; } catch { return null; }
}
function rememberPid(target, value) {
  const pid = Number(value);
  if (Number.isSafeInteger(pid) && pid > 0) target.add(pid);
}
function writeFinalReport(reportPath, report) {
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');
}
function vscodeProduct(executable) {
  const installation = path.dirname(executable);
  const direct = path.join(installation, 'resources', 'app', 'product.json');
  const candidates = [direct];
  if (!fs.existsSync(direct)) {
    for (const entry of fs.readdirSync(installation, { withFileTypes: true })) {
      if (entry.isDirectory()) candidates.push(path.join(installation, entry.name, 'resources', 'app', 'product.json'));
    }
  }
  for (const candidate of candidates) {
    const product = readJson(candidate);
    if (product) return { product, productPath: candidate };
  }
  return { product: null, productPath: direct };
}
async function downloadPinnedVscode(ownedPids) {
  const downloader = spawn(process.execPath, [path.join(__dirname, 'downloadVscodeTestRuntime.js'), expectedVscodeVersion], {
    cwd: extensionRoot,
    env: isolatedEnvironment(),
    windowsHide: true,
    shell: false,
  });
  rememberPid(ownedPids, ownedChildPid(downloader));
  let stdout = '';
  let stderr = '';
  downloader.stdout?.on('data', chunk => { stdout += String(chunk); });
  downloader.stderr?.on('data', chunk => { stderr += String(chunk); });
  const exited = new Promise((resolve, reject) => {
    downloader.once('error', reject);
    downloader.once('close', (code, signal) => resolve({ code: code ?? 1, signal: signal || null }));
  });
  let deadlineTimer;
  const deadline = new Promise(resolve => { deadlineTimer = setTimeout(() => resolve(null), downloadTimeoutMs); });
  let result;
  try { result = await Promise.race([exited, deadline]); }
  finally { if (deadlineTimer) clearTimeout(deadlineTimer); }
  if (!result) {
    await terminateOwnedProcessTree(downloader, 15000);
    throw new Error(`VS Code ${expectedVscodeVersion} download timed out after ${downloadTimeoutMs / 1000} seconds`);
  }
  if (result.code !== 0) throw new Error(`VS Code ${expectedVscodeVersion} download failed with code ${result.code}${result.signal ? ` (${result.signal})` : ''}: ${stderr.trim().slice(-1000)}`);
  let output;
  try { output = JSON.parse(stdout.trim().split(/\r?\n/).filter(Boolean).at(-1)); } catch { throw new Error(`VS Code ${expectedVscodeVersion} downloader returned invalid output: ${stdout.slice(-1000)}`); }
  if (!output || typeof output.executable !== 'string' || !fs.existsSync(output.executable)) throw new Error(`VS Code ${expectedVscodeVersion} downloader did not return an executable`);
  return output.executable;
}

async function main() {
  const runId = crypto.randomUUID();
  const reportPath = process.env.STAGE4_E2E_REPORT || path.join(repoRoot, 'artifacts', 'test-results', 'stage04-extension-host-e2e.json');
  const keepTemp = process.env.STAGE4_E2E_KEEP_TEMP === '1';
  const ownedPids = new Set();
  let tempRoot;
  let child;
  let childClose;
  let hardTimeout;
  let failure;
  let suiteReport = null;
  let timedOut = false;
  let childExitCode = null;
  let childExitSignal = null;
  const cleanup = { attemptedOwnedTreeTermination: false, ownedTreeClosed: true, tempRemoved: false, tempKept: keepTemp };

  try {
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.rmSync(reportPath, { force: true });
    fs.rmSync(reportPath.replace(/\.json$/, '.trace.log'), { force: true });
    const preferredTempBase = process.env.STAGE4_E2E_TEMP_BASE || 'C:\\tmp';
    let tempBase = os.tmpdir();
    try { fs.accessSync(preferredTempBase, fs.constants.W_OK); tempBase = preferredTempBase; } catch { /* use the OS temp directory */ }
    tempRoot = fs.mkdtempSync(path.join(tempBase, 'ai-worklog-stage4-e2e-'));
    const workspace = path.join(tempRoot, 'workspace');
    const dataDir = path.join(tempRoot, 'data');
    fs.cpSync(fixture, workspace, { recursive: true });
    fs.mkdirSync(dataDir, { recursive: true });
    const settingsPath = path.join(workspace, '.vscode', 'settings.json');
    const settings = { 'aiWorklog.serverPort': 0, 'aiWorklog.dataDir': dataDir, 'aiWorklog.eventCapture.enabled': true, 'aiWorklog.eventCapture.flushIntervalMs': 500 };
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf8');

    const vscodeExecutablePath = process.env.VSCODE_EXECUTABLE || await downloadPinnedVscode(ownedPids);
    const { product } = vscodeProduct(vscodeExecutablePath);
    if (product?.version !== expectedVscodeVersion) throw new Error(`Expected VS Code ${expectedVscodeVersion}, received ${product?.version || 'unknown'}`);
    if (!fs.existsSync(path.join(extensionRoot, 'server', 'ai-worklog-server.exe'))) throw new Error('Packaged backend missing; run scripts/build-extension.ps1 first');

    const args = [workspace, '--no-sandbox', '--disable-gpu-sandbox', '--disable-updates', '--skip-welcome', '--skip-release-notes', '--disable-workspace-trust', `--extensionTestsPath=${path.join(extensionRoot, 'test', 'suite')}`, `--extensionDevelopmentPath=${extensionRoot}`, `--user-data-dir=${path.join(tempRoot, 'user-data')}`, `--extensions-dir=${path.join(tempRoot, 'extensions')}`, '--verbose'];
    child = spawn(vscodeExecutablePath, args, {
      env: isolatedEnvironment({ STAGE4_E2E_REPORT: reportPath, STAGE4_E2E_RUN_ID: runId, STAGE4_E2E_WORKSPACE: workspace, STAGE4_E2E_DATA_DIR: dataDir }),
      windowsHide: true,
      shell: false,
    });
    rememberPid(ownedPids, ownedChildPid(child));
    child.stdout?.on('data', data => process.stdout.write(data));
    child.stderr?.on('data', data => process.stderr.write(data));
    childClose = new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (code, signal) => resolve({ code: code ?? 1, signal: signal || null }));
    });
    const timeout = new Promise((_, reject) => {
      hardTimeout = setTimeout(() => {
        timedOut = true;
        reject(new Error(`hard timeout after ${hardTimeoutMs / 1000} seconds`));
      }, hardTimeoutMs);
    });
    const exited = await Promise.race([childClose, timeout]);
    childExitCode = exited.code;
    childExitSignal = exited.signal;
    if (childExitCode !== 0) throw new Error(`Extension Host exited with code ${childExitCode}${childExitSignal ? ` (${childExitSignal})` : ''}`);
  } catch (error) {
    failure = error;
  } finally {
    if (hardTimeout) clearTimeout(hardTimeout);
    const reportCandidate = readJson(reportPath);
    cleanup.suiteReportRunIdMatched = reportCandidate ? reportCandidate.runId === runId : null;
    if (cleanup.suiteReportRunIdMatched) {
      suiteReport = reportCandidate;
      rememberPid(ownedPids, suiteReport.backendPid);
      for (const pid of suiteReport.ownedBackendPids || []) rememberPid(ownedPids, pid);
    } else if (reportCandidate && !failure) {
      failure = new Error('Extension Host E2E report did not belong to this launcher run');
    }

    if (child && ownedChildPid(child)) {
      const terminated = await terminateOwnedProcessTree(child, 15000);
      cleanup.attemptedOwnedTreeTermination = terminated.attempted;
      cleanup.ownedTreeClosed = terminated.closed;
      if (!terminated.closed && !failure) failure = new Error(`owned VS Code process tree ${terminated.pid} did not exit`);
    }
    if (childClose && !ownedChildPid(child)) {
      try {
        const exited = await childClose;
        childExitCode ??= exited.code;
        childExitSignal ??= exited.signal;
      } catch (error) {
        if (!failure) failure = error;
      }
    }

    const residualPids = await waitForProcessesToExit([...ownedPids], 15000);
    cleanup.residualPids = residualPids;
    cleanup.ownedProcessCount = ownedPids.size;
    if (residualPids.length && !failure) failure = new Error(`owned processes still alive after cleanup: ${residualPids.join(', ')}`);

    if (tempRoot) {
      if (keepTemp) {
        console.error(`STAGE4_EXTENSION_HOST_E2E_TEMP=${tempRoot}`);
      } else {
        try { fs.rmSync(tempRoot, { recursive: true, force: true }); cleanup.tempRemoved = true; }
        catch (error) { cleanup.tempRemovalError = errorMessage(error); if (!failure) failure = error; }
      }
    }

    if (!suiteReport && !failure) failure = new Error('Extension Host E2E report was not produced');
    if (suiteReport && !String(suiteReport.status || '').startsWith('passed') && !failure) failure = new Error(`Extension Host E2E reported status ${suiteReport.status || 'unknown'}`);
    const cleanupVerified = residualPids.length === 0 && cleanup.ownedTreeClosed && (keepTemp || cleanup.tempRemoved || !tempRoot);
    const finalReport = {
      ...(suiteReport || {}),
      runId,
      status: failure ? 'failed' : suiteReport.status,
      ...(failure ? { error: errorMessage(failure) } : {}),
      testVscodeVersion: expectedVscodeVersion,
      childExitCode,
      childExitSignal,
      residualProcessCount: residualPids.length,
      cleanupVerified,
      cleanup: { ...cleanup, timedOut },
    };
    try { writeFinalReport(reportPath, finalReport); }
    catch (error) { if (!failure) failure = error; console.error(`STAGE4_EXTENSION_HOST_E2E_REPORT_WRITE=FAIL ${errorMessage(error)}`); }
  }

  if (failure) {
    console.error(`STAGE4_EXTENSION_HOST_E2E=FAIL ${errorMessage(failure)}`);
    process.exitCode = 1;
  } else {
    console.log('STAGE4_EXTENSION_HOST_E2E=PASS');
  }
}

main().catch(error => { console.error(`STAGE4_EXTENSION_HOST_E2E=FAIL ${errorMessage(error)}`); process.exitCode = 1; });
