const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const http = require('node:http');
const { launch } = require('./vscodeTestLauncher');

const root = path.resolve(__dirname, '..');
const repo = path.resolve(root, '..', '..');
const fixture = path.join(root, 'test-fixtures', 'event-capture-workspace');
const temp = fs.mkdtempSync(path.join(repo, 'artifacts', 'ai-worklog-stage7-e2e-'));
const workspace = path.join(temp, 'workspace'); const data = path.join(temp, 'data');
const report = process.env.STAGE7_E2E_REPORT || path.join(repo, 'artifacts', 'test-results', 'stage07-extension-host-ai-provider.json');
const key = `stage7-${crypto.randomUUID()}`;
fs.cpSync(fixture, workspace, { recursive: true }); fs.mkdirSync(data, { recursive: true }); fs.mkdirSync(path.join(workspace, '.vscode'), { recursive: true });
fs.writeFileSync(path.join(workspace, '.vscode', 'settings.json'), JSON.stringify({ 'aiWorklog.serverPort': 0, 'aiWorklog.dataDir': data }));
const received = []; const fake = http.createServer((req, res) => { let body = ''; req.on('data', chunk => body += chunk); req.on('end', () => { try { received.push({ auth: req.headers.authorization, body: JSON.parse(body) }); res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ choices: [{ message: { content: 'OK' } }] })); } catch { res.statusCode = 400; res.end('bad'); } }); });
(async () => { try { await new Promise(resolve => fake.listen(0, '127.0.0.1', resolve)); const port = fake.address().port; const launched = await launch({ extensionDevelopmentPath: root, extensionTestsPath: path.join(root, 'test', 'suite'), workspace, userData: path.join(temp, 'user-data'), extensions: path.join(temp, 'extensions'), logs: path.join(temp, 'vscode-logs'), env: { STAGE7_E2E: '1', STAGE7_E2E_REPORT: report, STAGE7_FAKE_URL: `http://127.0.0.1:${port}/v1`, STAGE7_SYNTHETIC_KEY: key } }); if (launched.code !== 0) throw Error(`Extension Host exited ${launched.code}`); if (received.length !== 3) throw Error(`expected 3 provider calls, got ${received.length}`); if (received.some(item => item.auth !== `Bearer ${key}` || JSON.stringify(item.body).includes('taskId'))) throw Error('fake provider contract failed'); } catch (error) { fs.mkdirSync(path.dirname(report), { recursive: true }); if (!fs.existsSync(report)) fs.writeFileSync(report, JSON.stringify({ status:'failed', error:String(error).replace(key,'[REDACTED]') },null,2)); console.error(error); process.exitCode=1; } finally { await new Promise(resolve=>fake.close(resolve)); if(process.env.STAGE7_E2E_KEEP_TEMP==='1')console.error(`STAGE7_E2E_TEMP=${temp}`);else fs.rmSync(temp,{recursive:true,force:true}); } })();
