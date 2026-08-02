const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { downloadAndUnzipVSCode } = require('@vscode/test-electron');

const REMOVED_ENV = ['ELECTRON_RUN_AS_NODE','NODE_OPTIONS','VSCODE_IPC_HOOK','VSCODE_IPC_HOOK_CLI','VSCODE_NLS_CONFIG','VSCODE_CWD','VSCODE_PID','VSCODE_PORTABLE','VSCODE_EXTENSIONS'];
function isolatedEnvironment(extra = {}) { const env = { ...process.env, ...extra }; for (const key of REMOVED_ENV) delete env[key]; return env; }
async function launch({ version = '1.85.2', extensionDevelopmentPath, extensionTestsPath, workspace, userData, extensions, logs, env = {}, onSpawn }) {
  const executable = await downloadAndUnzipVSCode(version);
  const product = JSON.parse(fs.readFileSync(path.join(path.dirname(executable), 'resources', 'app', 'product.json'), 'utf8'));
  const args = [workspace, `--user-data-dir=${userData}`, `--extensions-dir=${extensions}`, '--disable-updates', '--skip-welcome', '--skip-release-notes', '--disable-workspace-trust', '--verbose', '--disable-gpu-sandbox', `--logsPath=${logs}`, `--extensionTestsPath=${extensionTestsPath}`, `--extensionDevelopmentPath=${extensionDevelopmentPath}`];
  const child = spawn(executable, args, { env: isolatedEnvironment(env), shell: false, windowsHide: true });
  onSpawn?.({ child, executable, args, product, removedEnvironment: REMOVED_ENV.map(key => ({ key, existed: Object.prototype.hasOwnProperty.call(process.env, key), removed: true })) });
  return await new Promise((resolve, reject) => { child.on('error', reject); child.on('close', (code, signal) => resolve({ code, signal, executable, args, product })); });
}
module.exports = { launch, REMOVED_ENV };
