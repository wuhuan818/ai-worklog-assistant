const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { downloadAndUnzipVSCode } = require('@vscode/test-electron');

const REMOVED_ENV = ['ELECTRON_RUN_AS_NODE','NODE_OPTIONS','VSCODE_IPC_HOOK','VSCODE_IPC_HOOK_CLI','VSCODE_NLS_CONFIG','VSCODE_CWD','VSCODE_PID','VSCODE_PORTABLE','VSCODE_EXTENSIONS'];
function isolatedEnvironment(extra = {}) { const env = { ...process.env, ...extra }; for (const key of REMOVED_ENV) delete env[key]; return env; }
function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function ownedChildPid(child) {
  const pid = Number(child?.pid);
  if (!Number.isSafeInteger(pid) || pid <= 0) return undefined;
  if (child.exitCode !== null && child.exitCode !== undefined) return undefined;
  if (child.signalCode !== null && child.signalCode !== undefined) return undefined;
  return pid;
}
function waitForChildClose(child, timeoutMs = 15000) {
  if (!ownedChildPid(child)) return Promise.resolve(true);
  return new Promise(resolve => {
    const finish = value => { clearTimeout(timer); child.removeListener('close', onClose); resolve(value); };
    const onClose = () => finish(true);
    const timer = setTimeout(() => finish(false), timeoutMs);
    child.once('close', onClose);
  });
}
function runOwnedCleanupCommand(executable, args, timeoutMs) {
  return new Promise(resolve => {
    let settled = false;
    const command = spawn(executable, args, { shell: false, windowsHide: true, stdio: 'ignore' });
    const finish = result => { if (!settled) { settled = true; clearTimeout(timer); resolve(result); } };
    const timer = setTimeout(() => { command.kill(); finish({ code: null, timedOut: true }); }, timeoutMs);
    command.once('error', error => finish({ code: null, error: String(error) }));
    command.once('close', code => finish({ code }));
  });
}
async function terminateOwnedProcessTree(child, timeoutMs = 15000) {
  const pid = ownedChildPid(child);
  if (!pid) return { attempted: false, pid: null, closed: true };
  let commandResult;
  if (process.platform === 'win32') {
    const systemTaskkill = process.env.SystemRoot ? path.join(process.env.SystemRoot, 'System32', 'taskkill.exe') : '';
    const taskkill = systemTaskkill && fs.existsSync(systemTaskkill) ? systemTaskkill : 'taskkill.exe';
    // The root is the exact PID of the ChildProcess object spawned by this
    // launcher. /T is therefore limited to this owned tree; no image-name or
    // broad process search is ever used.
    commandResult = await runOwnedCleanupCommand(taskkill, ['/PID', String(pid), '/T', '/F'], Math.min(timeoutMs, 10000));
  } else {
    child.kill('SIGTERM');
    commandResult = { code: 0 };
  }
  let closed = await waitForChildClose(child, timeoutMs);
  if (!closed && ownedChildPid(child)) {
    if (process.platform === 'win32') {
      const systemTaskkill = process.env.SystemRoot ? path.join(process.env.SystemRoot, 'System32', 'taskkill.exe') : '';
      const taskkill = systemTaskkill && fs.existsSync(systemTaskkill) ? systemTaskkill : 'taskkill.exe';
      commandResult = await runOwnedCleanupCommand(taskkill, ['/PID', String(pid), '/T', '/F'], Math.min(timeoutMs, 10000));
    } else {
      child.kill('SIGKILL');
    }
    closed = await waitForChildClose(child, timeoutMs);
  }
  return { attempted: true, pid, closed, commandResult };
}
function isProcessAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (error) { return error?.code === 'EPERM'; }
}
async function waitForProcessesToExit(pids, timeoutMs = 15000) {
  const owned = [...new Set(pids.filter(pid => Number.isSafeInteger(pid) && pid > 0))];
  const deadline = Date.now() + timeoutMs;
  let residual = owned.filter(isProcessAlive);
  while (residual.length && Date.now() < deadline) {
    await delay(100);
    residual = owned.filter(isProcessAlive);
  }
  return residual;
}
async function launch({ version = '1.93.1', extensionDevelopmentPath, extensionTestsPath, workspace, userData, extensions, logs, env = {}, onSpawn }) {
  const executable = await downloadAndUnzipVSCode(version);
  const product = JSON.parse(fs.readFileSync(path.join(path.dirname(executable), 'resources', 'app', 'product.json'), 'utf8'));
  const args = [workspace, `--user-data-dir=${userData}`, `--extensions-dir=${extensions}`, '--disable-updates', '--skip-welcome', '--skip-release-notes', '--disable-workspace-trust', '--verbose', '--disable-gpu-sandbox', `--logsPath=${logs}`, `--extensionTestsPath=${extensionTestsPath}`, `--extensionDevelopmentPath=${extensionDevelopmentPath}`];
  const child = spawn(executable, args, { env: isolatedEnvironment(env), shell: false, windowsHide: true });
  let stdout = ''; let stderr = '';
  child.stdout?.on('data', chunk => { stdout += String(chunk); });
  child.stderr?.on('data', chunk => { stderr += String(chunk); });
  onSpawn?.({ child, executable, args, product, removedEnvironment: REMOVED_ENV.map(key => ({ key, existed: Object.prototype.hasOwnProperty.call(process.env, key), removed: true })) });
  return await new Promise((resolve, reject) => { child.on('error', reject); child.on('close', (code, signal) => resolve({ code, signal, executable, args, product, stdout, stderr })); });
}
module.exports = { isolatedEnvironment, isProcessAlive, launch, ownedChildPid, REMOVED_ENV, terminateOwnedProcessTree, waitForChildClose, waitForProcessesToExit };
