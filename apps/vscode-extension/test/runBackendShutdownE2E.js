const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), { spawn } = require('node:child_process');
const { downloadAndUnzipVSCode } = require('@vscode/test-electron');
const root = path.resolve(__dirname, '..'), repo = path.resolve(root, '..', '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-worklog-stage071-e2e-')), workspace = path.join(root, 'test-fixtures', 'event-capture-workspace');
const report = process.env.STAGE071_E2E_REPORT || path.join(repo, 'artifacts', 'test-results', 'stage071-backend-shutdown-e2e.json');
function alive(pid) { try { process.kill(pid, 0); return true; } catch { return false; } }
(async () => { try {
  fs.mkdirSync(path.dirname(report), { recursive: true });
  const executable = process.env.VSCODE_EXECUTABLE || await downloadAndUnzipVSCode('1.85.2');
  const args = [workspace, '--no-sandbox', '--disable-gpu-sandbox', '--disable-updates', '--skip-welcome', '--disable-workspace-trust', `--extensionTestsPath=${path.join(root, 'test', 'suite')}`, `--extensionDevelopmentPath=${root}`, `--user-data-dir=${path.join(temp, 'user')}`, `--extensions-dir=${path.join(temp, 'extensions')}`];
  const code = await new Promise((resolve, reject) => { const child = spawn(executable, args, { env: { ...process.env, STAGE071_E2E_REPORT: report }, windowsHide: true }); child.on('error', reject); child.on('close', value => resolve(value ?? 1)); });
  const result = JSON.parse(fs.readFileSync(report, 'utf8')); if (code !== 0 || result.status !== 'host-ready') throw new Error(`Extension Host exited ${code}`);
  const deadline = Date.now() + 10000; while (Date.now() < deadline && alive(result.backendPid)) await new Promise(resolve => setTimeout(resolve, 200));
  if (alive(result.backendPid)) throw new Error(`backend PID ${result.backendPid} survived host shutdown`);
  fs.writeFileSync(report, JSON.stringify({ ...result, status: 'passed', backendExited: true }, null, 2), 'utf8');
} catch (error) { fs.writeFileSync(report, JSON.stringify({ status: 'failed', error: String(error) }, null, 2), 'utf8'); console.error(error); process.exitCode = 1; } finally { fs.rmSync(temp, { recursive: true, force: true }); } })();
