import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { BackendProcessManager } from './backendProcessManager';
import { DiagnosticLogger } from './diagnosticLogger';

const executable = process.env.AI_WORKLOG_BACKEND_EXE;
const integrationSkip = !executable;
const sleep = (milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds));

function isAlive(pid: number | undefined): boolean {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}

test('real packaged backend remains healthy across restart for five seconds', { skip: integrationSkip }, async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-worklog-manager-integration-'));
  const logPath = path.join(dataDir, 'ai-worklog.log');
  const outputLines: string[] = [];
  const logger = new DiagnosticLogger({ appendLine: line => outputLines.push(line), show: () => undefined }, logPath);
  const manager = new BackendProcessManager({
    executablePath: executable as string,
    port: 8765,
    dataDir,
    logger,
    logPath,
    mkdir: directory => fs.mkdirSync(directory, { recursive: true }),
  });
  try {
    await manager.start();
    const firstPid = manager.pid;
    assert.equal(manager.state, 'healthy');
    await sleep(5000);
    assert.equal(manager.state, 'healthy');
    assert.equal(isAlive(firstPid), true);

    await manager.restart();
    const secondPid = manager.pid;
    assert.equal(manager.state, 'healthy');
    assert.notEqual(secondPid, firstPid);
    await sleep(5000);
    assert.equal(manager.state, 'healthy');
    assert.equal(isAlive(secondPid), true);

    await manager.stop();
    assert.equal(manager.state, 'stopped');
    assert.equal(isAlive(secondPid), false);
    const persisted = fs.readFileSync(logPath, 'utf8');
    assert.match(persisted, /PID=/);
    assert.match(persisted, /端口=/);
    assert.match(persisted, /exitCode=/);
    assert.equal(persisted.includes('WORKLOG_SESSION_TOKEN'), false);
    assert.equal(outputLines.length > 0, true);
  } finally {
    await manager.stop();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
