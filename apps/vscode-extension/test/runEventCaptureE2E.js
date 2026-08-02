const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { downloadAndUnzipVSCode } = require('@vscode/test-electron');

const extensionRoot = path.resolve(__dirname, '..');
const fixture = path.join(extensionRoot, 'test-fixtures', 'event-capture-workspace');
const repoRoot = path.resolve(extensionRoot, '..', '..');
const runId = crypto.randomUUID();
const preferredTempBase = process.env.STAGE4_E2E_TEMP_BASE || 'C:\\tmp';
let tempBase = os.tmpdir();
try { fs.accessSync(preferredTempBase, fs.constants.W_OK); tempBase = preferredTempBase; } catch { /* use the OS temp directory */ }
const tempRoot = fs.mkdtempSync(path.join(tempBase, 'ai-worklog-stage4-e2e-'));
const workspace = path.join(tempRoot, 'workspace');
const dataDir = path.join(tempRoot, 'data');
const extensionAlias = extensionRoot;
const reportPath = process.env.STAGE4_E2E_REPORT || path.join(repoRoot, 'artifacts', 'test-results', 'stage04-extension-host-e2e.json');
const keepTemp = process.env.STAGE4_E2E_KEEP_TEMP === '1';

fs.cpSync(fixture, workspace, { recursive: true });
fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.rmSync(reportPath, { force: true });
fs.rmSync(reportPath.replace(/\.json$/, '.trace.log'), { force: true });
const settingsPath = path.join(workspace, '.vscode', 'settings.json');
const settings = { 'aiWorklog.serverPort': 0, 'aiWorklog.dataDir': dataDir, 'aiWorklog.eventCapture.enabled': true, 'aiWorklog.eventCapture.flushIntervalMs': 500 };
fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf8');

async function main() {
  const vscodeExecutablePath = process.env.VSCODE_EXECUTABLE || await downloadAndUnzipVSCode('1.85.2');
  if (!fs.existsSync(path.join(extensionRoot, 'server', 'ai-worklog-server.exe'))) throw new Error('Packaged backend missing; run scripts/build-extension.ps1 first');
  let exitCode = 1;
  try {
    const hardTimeout = setTimeout(() => { console.error('STAGE4_EXTENSION_HOST_E2E=FAIL hard timeout after 300 seconds'); process.exit(124); }, 300000);
    try {
      const args = [workspace, '--no-sandbox', '--disable-gpu-sandbox', '--disable-updates', '--skip-welcome', '--skip-release-notes', '--disable-workspace-trust', `--extensionTestsPath=${path.join(extensionAlias, 'test', 'suite')}`, `--extensionDevelopmentPath=${extensionAlias}`, `--user-data-dir=${path.join(tempRoot, 'user-data')}`, `--extensions-dir=${path.join(tempRoot, 'extensions')}`, '--verbose'];
      exitCode = await new Promise((resolve, reject) => { const child = spawn(vscodeExecutablePath, args, { env: { ...process.env, STAGE4_E2E_REPORT: reportPath, STAGE4_E2E_RUN_ID: runId, STAGE4_E2E_WORKSPACE: workspace, STAGE4_E2E_DATA_DIR: dataDir }, windowsHide: true, shell: false }); child.stdout.on('data', data => process.stdout.write(data)); child.stderr.on('data', data => process.stderr.write(data)); child.on('error', reject); child.on('close', code => resolve(code ?? 1)); });
    } finally { clearTimeout(hardTimeout); }
    if (exitCode !== 0) throw new Error(`Extension Host exited with code ${exitCode}`);
  } catch (error) {
    if (!fs.existsSync(reportPath)) fs.writeFileSync(reportPath, JSON.stringify({ status: 'failed', error: String(error), runId }, null, 2), 'utf8');
    console.error(`STAGE4_EXTENSION_HOST_E2E=FAIL ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  } finally {
    if (keepTemp) console.error(`STAGE4_EXTENSION_HOST_E2E_TEMP=${tempRoot}`);
    else fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
