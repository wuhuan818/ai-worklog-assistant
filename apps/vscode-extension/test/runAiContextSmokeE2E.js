const fs = require('node:fs');
const path = require('node:path');
const { launch } = require('./vscodeTestLauncher');
const root = path.resolve(__dirname, '..'); const repo = path.resolve(root, '..', '..');
const temp = fs.mkdtempSync(path.join(repo, 'artifacts', 'ai-worklog-stage08-smoke-')); const workspace = path.join(temp, 'workspace'); const data = path.join(temp, 'data');
fs.mkdirSync(path.join(workspace, '.vscode'), { recursive: true }); fs.mkdirSync(data, { recursive: true });
fs.writeFileSync(path.join(workspace, '.vscode', 'settings.json'), JSON.stringify({ 'aiWorklog.serverPort': 0, 'aiWorklog.dataDir': data }));
(async () => { try {
  const result = await launch({ extensionDevelopmentPath: root, extensionTestsPath: path.join(root, 'test', 'suite', 'index.js'), workspace, userData: path.join(temp, 'user-data'), extensions: path.join(temp, 'extensions'), logs: path.join(temp, 'logs'), env: { STAGE08_CONTEXT_SMOKE: '1' } });
  if (result.code !== 0) throw Error(`Extension Host exited ${result.code}\nstdout=${result.stdout}\nstderr=${result.stderr}`);
} catch (error) { console.error(error); process.exitCode = 1; }
finally { if (process.exitCode) console.error(`STAGE08_SMOKE_DIAGNOSTICS=${temp}`); else fs.rmSync(temp, { recursive: true, force: true }); } })();
