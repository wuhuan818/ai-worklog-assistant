const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), { spawn } = require('node:child_process');
const { downloadAndUnzipVSCode } = require('@vscode/test-electron');
const root = path.resolve(__dirname, '..'), repo = path.resolve(root, '..', '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-worklog-stage071-e2e-')), workspace = path.join(root, 'test-fixtures', 'event-capture-workspace');
const report = process.env.STAGE071_E2E_REPORT || path.join(repo, 'artifacts', 'test-results', 'stage071-backend-shutdown-e2e.json');
const diagnostics = path.join(repo, 'artifacts', 'e2e-diagnostics', `stage071-${path.basename(temp)}`);
function alive(pid) { try { process.kill(pid, 0); return true; } catch { return false; } }
function sanitizedEnv() { const env = { ...process.env }; for (const key of ['ELECTRON_RUN_AS_NODE', 'NODE_OPTIONS', 'VSCODE_IPC_HOOK', 'VSCODE_IPC_HOOK_CLI', 'VSCODE_NLS_CONFIG', 'VSCODE_CWD', 'VSCODE_PID', 'VSCODE_PORTABLE', 'VSCODE_EXTENSIONS']) delete env[key]; return env; }
(async () => { let succeeded = false; try {
  fs.mkdirSync(path.dirname(report), { recursive: true });
  const executable = process.env.VSCODE_EXECUTABLE || await downloadAndUnzipVSCode('1.85.2');
  const args = [workspace, '--no-sandbox', '--disable-gpu-sandbox', '--disable-updates', '--skip-welcome', '--disable-workspace-trust', '--verbose', `--logsPath=${path.join(temp, 'logs')}`, `--extensionTestsPath=${path.join(root, 'test', 'suite', 'index.js')}`, `--extensionDevelopmentPath=${root}`, `--user-data-dir=${path.join(temp, 'user')}`, `--extensions-dir=${path.join(temp, 'extensions')}`];
  const code = await new Promise((resolve, reject) => { const child = spawn(executable, args, { env: { ...sanitizedEnv(), STAGE071_E2E_REPORT: report }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }); const stdout = fs.createWriteStream(path.join(temp, 'vscode.stdout.log')); const stderr = fs.createWriteStream(path.join(temp, 'vscode.stderr.log')); child.stdout.pipe(stdout); child.stderr.pipe(stderr); child.on('error', reject); child.on('close', value => resolve(value ?? 1)); });
  const result = JSON.parse(fs.readFileSync(report, 'utf8')); if (code !== 0 || result.status !== 'host-ready') throw new Error(`Extension Host exited ${code}`);
  const deadline = Date.now() + 10000; while (Date.now() < deadline && alive(result.backendPid)) await new Promise(resolve => setTimeout(resolve, 200));
  if (alive(result.backendPid)) throw new Error(`backend PID ${result.backendPid} survived host shutdown`);
  fs.writeFileSync(report, JSON.stringify({ ...result, status: 'passed', backendExited: true }, null, 2), 'utf8'); succeeded = true;
} catch (error) { fs.mkdirSync(path.dirname(report), { recursive: true }); fs.writeFileSync(report, JSON.stringify({ status: 'failed', error: String(error), diagnostics }, null, 2), 'utf8'); console.error(error); process.exitCode = 1; } finally { if (succeeded) fs.rmSync(temp, { recursive: true, force: true }); else { fs.mkdirSync(path.dirname(diagnostics), { recursive: true }); fs.renameSync(temp, diagnostics); console.error(`STAGE071_DIAGNOSTICS=${diagnostics}`); } } })();
