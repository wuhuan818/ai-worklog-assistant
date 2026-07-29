import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import { BackendProcessManager } from './backendProcessManager';

class FakeProcess extends EventEmitter {
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly pid = 3210;
  killed = false;
  kill(): boolean { this.killed = true; queueMicrotask(() => this.emit('exit', 0, null)); return true; }
}

function manager(overrides: Partial<ConstructorParameters<typeof BackendProcessManager>[0]> = {}) {
  const logs: string[] = [];
  const processes: FakeProcess[] = [];
  const options: ConstructorParameters<typeof BackendProcessManager>[0] = {
    executablePath: 'C:\\workspace with spaces\\ai-worklog-server.exe',
    port: 18765,
    dataDir: 'C:\\Users\\tester\\AppData\\Local\\AIWorklogAssistant',
    logger: { appendLine: line => logs.push(line) },
    spawnProcess: () => { const process = new FakeProcess(); processes.push(process); return process as unknown as import('node:child_process').ChildProcess; },
    healthCheck: async () => undefined,
    killProcess: async child => { child.kill(); },
    pollIntervalMs: 1,
    startupTimeoutMs: 50,
    stopTimeoutMs: 50,
    ...overrides,
  };
  return { instance: new BackendProcessManager(options), logs, processes, options };
}

test('starts once, passes token/port/data directory, and becomes healthy', async () => {
  let spawnOptions: import('node:child_process').SpawnOptions | undefined;
  let healthToken = '';
  const setup = manager({
    spawnProcess: (_command, _args, options) => { spawnOptions = options; const process = new FakeProcess(); setup.processes.push(process); return process as unknown as import('node:child_process').ChildProcess; },
    healthCheck: async (_url, token) => { healthToken = token; },
  });
  const first = await setup.instance.start();
  const second = await setup.instance.start();
  assert.equal(first, second);
  assert.equal(setup.instance.state, 'healthy');
  assert.equal(setup.instance.pid, 3210);
  const env = spawnOptions?.env as NodeJS.ProcessEnv;
  assert.equal(env.WORKLOG_PORT, '18765');
  assert.equal(env.WORKLOG_DATA_DIR, setup.options.dataDir);
  assert.ok(env.WORKLOG_SESSION_TOKEN);
  assert.equal(healthToken, env.WORKLOG_SESSION_TOKEN);
});

test('duplicate concurrent starts share one promise and one process', async () => {
  let resolveHealth: (() => void) | undefined;
  const setup = manager({ healthCheck: async () => new Promise<void>(resolve => { resolveHealth = resolve; }) });
  const first = setup.instance.start();
  const second = setup.instance.start();
  while (!resolveHealth) await new Promise(resolve => setImmediate(resolve));
  assert.equal(setup.processes.length, 1);
  resolveHealth?.();
  await Promise.all([first, second]);
});

test('launch failure becomes error', async () => {
  const setup = manager({ spawnProcess: () => { throw new Error('missing executable'); } });
  await assert.rejects(() => setup.instance.start(), /missing executable/);
  assert.equal(setup.instance.state, 'error');
});

test('health timeout becomes error and stops the owned process', async () => {
  const setup = manager({ startupTimeoutMs: 10, healthRequestTimeoutMs: 2, healthCheck: async () => new Promise<void>(() => undefined) });
  await assert.rejects(() => setup.instance.start(), /健康检查超时/);
  assert.equal(setup.instance.state, 'error');
  assert.equal(setup.processes[0].killed, true);
});

test('stop and restart replace the owned process', async () => {
  const setup = manager();
  await setup.instance.start();
  await setup.instance.stop();
  assert.equal(setup.instance.state, 'stopped');
  await setup.instance.restart();
  assert.equal(setup.processes.length, 2);
  assert.equal(setup.instance.state, 'healthy');
});

test('abnormal exit becomes error and logs exit code', async () => {
  const setup = manager();
  await setup.instance.start();
  setup.processes[0].emit('exit', 7, null);
  assert.equal(setup.instance.state, 'error');
  assert.match(setup.logs.join('\n'), /exitCode=7/);
});

test('captured output never leaks the session token', async () => {
  let process: FakeProcess | undefined;
  let token = '';
  const setup = manager({
    spawnProcess: () => { process = new FakeProcess(); setup.processes.push(process); return process as unknown as import('node:child_process').ChildProcess; },
    healthCheck: async (_url, value) => { token = value; },
  });
  await setup.instance.start();
  process?.stdout.write(`token=${token}`);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(setup.logs.some(line => line.includes(token)), false);
});

test('a stale exit event cannot change the state of a newer generation', async () => {
  const setup = manager();
  await setup.instance.start();
  const first = setup.processes[0];
  await setup.instance.restart();
  assert.equal(setup.instance.state, 'healthy');
  first.emit('exit', 1, null);
  assert.equal(setup.instance.state, 'healthy');
  assert.match(setup.logs.join('\n'), /忽略旧进程 exit event/);
  await setup.instance.stop();
});
