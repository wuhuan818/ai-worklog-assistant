import { randomBytes, randomUUID } from 'node:crypto';
import { ChildProcess, execFile, spawn, SpawnOptions } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as net from 'node:net';
import { ApiClient } from './apiClient';
import { BackendState } from './backendState';

export interface BackendLogger {
  appendLine(value: string): void;
}

export interface BackendProcessManagerOptions {
  executablePath: string | (() => string);
  port: number;
  dataDir: string;
  runtimeMode?: 'production' | 'development' | 'test';
  startupTimeoutMs?: number;
  healthRequestTimeoutMs?: number;
  pollIntervalMs?: number;
  stopTimeoutMs?: number;
  logger?: BackendLogger;
  spawnProcess?: (command: string, args: string[], options: SpawnOptions) => ChildProcess;
  portSelector?: (preferredPort: number) => Promise<number>;
  killProcess?: (child: ChildProcess) => Promise<void>;
  healthCheck?: (baseUrl: string, token: string) => Promise<void>;
  mkdir?: (directory: string) => void;
  logPath?: string;
  runtimeRegistryDir?: string;
  extensionInstanceId?: string;
}

export interface BackendStateChange {
  state: BackendState;
  pid?: number;
  port: number;
  error?: string;
}

type Listener = (change: BackendStateChange) => void;

function safeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function redact(value: string, token: string): string {
  return value
    .replaceAll(token, '[REDACTED]')
    .replace(/(authorization|api[_-]?key|secret|password|token)(\s*[:=]\s*)[^\s,;]+/gi, '$1$2[REDACTED]')
    .replace(/\bsk-[A-Za-z0-9_-]{10,}\b/g, '[REDACTED]');
}

function probePort(port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      const address = server.address();
      const selected = typeof address === 'object' && address ? address.port : port;
      server.close(error => error ? reject(error) : resolve(selected));
    });
  });
}

async function selectAvailablePort(preferredPort: number): Promise<number> {
  try { return await probePort(preferredPort); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw error;
    return probePort(0);
  }
}

function terminateOwnedProcess(child: ChildProcess): Promise<void> {
  if (process.platform !== 'win32' || !child.pid) {
    try { child.kill(); } catch { /* The exit event will complete cleanup. */ }
    return Promise.resolve();
  }
  return new Promise(resolve => {
    execFile('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], () => resolve());
  });
}

export class BackendProcessManager {
  private readonly token = randomBytes(24).toString('hex');
  private readonly spawnProcess: NonNullable<BackendProcessManagerOptions['spawnProcess']>;
  private readonly healthCheck: NonNullable<BackendProcessManagerOptions['healthCheck']>;
  private readonly startupTimeoutMs: number;
  private readonly healthRequestTimeoutMs: number;
  private readonly pollIntervalMs: number;
  private readonly stopTimeoutMs: number;
  private readonly portSelector: NonNullable<BackendProcessManagerOptions['portSelector']>;
  private readonly killProcess: NonNullable<BackendProcessManagerOptions['killProcess']>;
  private readonly listeners = new Set<Listener>();
  private process?: ChildProcess;
  private client?: ApiClient;
  private startPromise?: Promise<ApiClient>;
  private stopping = false;
  private currentState: BackendState = 'stopped';
  private lastError?: string;
  private activePort: number;
  private generation = 0;
  private activeGeneration = 0;
  private readonly extensionInstanceId: string;
  private stopPromise?: Promise<void>;
  private shutdownPromise?: Promise<void>;
  private shutdownRequested = false;

  constructor(private readonly options: BackendProcessManagerOptions) {
    this.spawnProcess = options.spawnProcess || spawn;
    this.healthCheck = options.healthCheck || (async (baseUrl, token) => { await new ApiClient(baseUrl, token).health(); });
    this.startupTimeoutMs = options.startupTimeoutMs ?? 10000;
    this.healthRequestTimeoutMs = options.healthRequestTimeoutMs ?? 1000;
    this.pollIntervalMs = options.pollIntervalMs ?? 250;
    this.stopTimeoutMs = options.stopTimeoutMs ?? 3000;
    this.portSelector = options.portSelector || selectAvailablePort;
    this.killProcess = options.killProcess || terminateOwnedProcess;
    this.activePort = options.port;
    this.extensionInstanceId = options.extensionInstanceId || randomUUID();
  }

  get state(): BackendState { return this.currentState; }
  get pid(): number | undefined { return this.process?.pid; }
  get port(): number { return this.activePort; }
  get api(): ApiClient | undefined { return this.client; }
  get running(): boolean { return this.currentState === 'starting' || this.currentState === 'healthy'; }
  get lastErrorMessage(): string | undefined { return this.lastError; }
  get logPath(): string | undefined { return this.options.logPath; }
  get dataDir(): string { return this.options.dataDir; }
  get backendGeneration(): number { return this.activeGeneration; }
  get instanceId(): string { return this.extensionInstanceId; }

  onDidChangeState(listener: Listener): { dispose: () => void } {
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  }

  async start(): Promise<ApiClient> {
    if (this.shutdownRequested) throw new Error('后端正在关闭，不能启动新进程');
    if (this.startPromise) return this.startPromise;
    if (this.client && this.currentState === 'healthy') return this.client;
    this.startPromise = this.startInternal().finally(() => { this.startPromise = undefined; });
    return this.startPromise;
  }

  private async startInternal(): Promise<ApiClient> {
    this.lastError = undefined;
    this.setState('starting');
    let executable: string;
    try { executable = typeof this.options.executablePath === 'function' ? this.options.executablePath() : this.options.executablePath; }
    catch (error) { return this.fail(error); }

    try { this.activePort = await this.portSelector(this.options.port); }
    catch (error) { return this.fail(error); }
    this.log(`解析出的后端路径：${executable}`);
    this.log(`EXE 是否存在：true`);
    this.log(`启动时间：${new Date().toISOString()}；端口：${this.activePort}；用户数据目录：${this.options.dataDir}`);
    try { this.options.mkdir?.(this.options.dataDir); } catch (error) { return this.fail(error); }

    let spawnError: Error | undefined;
    let processExited = false;
    const processGeneration = ++this.generation;
    this.activeGeneration = processGeneration;
    try {
      this.stopping = false;
      const child = this.spawnProcess(executable, [], {
        env: {
          ...process.env,
          WORKLOG_SESSION_TOKEN: this.token,
          WORKLOG_PORT: String(this.activePort),
          WORKLOG_DATA_DIR: this.options.dataDir,
          AI_WORKLOG_DATA_DIR: this.options.dataDir,
          AI_WORKLOG_RUNTIME_MODE: this.options.runtimeMode || 'production',
          WORKLOG_EXTENSION_HOST_PID: String(process.pid),
          WORKLOG_EXTENSION_INSTANCE_ID: this.extensionInstanceId,
          WORKLOG_BACKEND_GENERATION: String(processGeneration),
        },
        windowsHide: true,
      });
      this.process = child;
      this.writeRegistry(executable, child.pid, processGeneration, 'starting');
      this.log(`spawn 成功：PID=${child.pid ?? 'unknown'}`);
      child.stdout?.on('data', data => this.log(`[stdout] ${String(data).trimEnd()}`));
      child.stderr?.on('data', data => this.log(`[stderr] ${String(data).trimEnd()}`));
      child.on('error', error => {
        if (this.process !== child || this.activeGeneration !== processGeneration) {
          this.log(`忽略旧进程 error event：PID=${child.pid ?? 'unknown'}`);
          return;
        }
        spawnError = error;
        this.lastError = safeError(error);
        this.log(`error event：${this.lastError}`);
        if (this.currentState === 'starting') this.setState('error', this.lastError);
      });
      child.on('exit', (code, signal) => {
        if (this.process !== child || this.activeGeneration !== processGeneration) {
          this.log(`忽略旧进程 exit event：PID=${child.pid ?? 'unknown'}，exitCode=${code ?? 'null'}`);
          return;
        }
        processExited = true;
        const abnormal = !this.stopping && code !== 0;
        this.log(`后端退出：PID=${child.pid ?? 'unknown'}，exitCode=${code ?? 'null'}，exitSignal=${signal ?? 'none'}`);
        this.client = undefined;
        this.process = undefined;
        this.removeRegistry();
        if (abnormal) this.setState('error', `后端异常退出（退出码 ${code ?? 'null'}）`);
        else if (this.currentState !== 'stopping') this.setState('stopped');
      });
    } catch (error) { return this.fail(error); }

    const baseUrl = `http://127.0.0.1:${this.activePort}`;
    const deadline = Date.now() + this.startupTimeoutMs;
    let lastError = '健康检查超时';
    while (Date.now() < deadline) {
      if (spawnError) return this.fail(spawnError);
      if (processExited) return this.fail(new Error('后端进程在健康检查期间退出'));
      try {
        await this.withTimeout(this.healthCheck(baseUrl, this.token), this.healthRequestTimeoutMs);
        this.client = new ApiClient(baseUrl, this.token);
        this.writeRegistry(executable, this.process?.pid, processGeneration, 'healthy');
        this.log(`health 请求结果：healthy；端口=${this.activePort}`);
        this.setState('healthy');
        return this.client;
      } catch (error) {
        lastError = safeError(error);
        this.log(`health 请求失败：${lastError}`);
        await new Promise(resolve => setTimeout(resolve, this.pollIntervalMs));
      }
    }
    return this.fail(new Error(`健康检查超时（${this.startupTimeoutMs}ms）：${lastError}`));
  }

  private async withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([promise, new Promise<T>((_, reject) => { timer = setTimeout(() => reject(new Error('健康请求超时')), timeoutMs); })]);
    } finally { if (timer) clearTimeout(timer); }
  }

  private async fail(error: unknown): Promise<never> {
    this.lastError = safeError(error);
    this.log(`错误摘要：${this.lastError}`);
    if (this.process) await this.stop();
    this.setState('error', this.lastError);
    throw new Error(`本地后端启动失败：${this.lastError}`);
  }

  async restart(): Promise<ApiClient> {
    if (this.shutdownRequested) throw new Error('后端正在关闭，不能重启');
    this.log('重启流程：开始停止旧进程');
    await this.stop();
    this.log('重启流程：旧进程已停止，开始启动新进程');
    if (this.shutdownRequested) throw new Error('后端正在关闭，取消重启');
    return this.start();
  }

  async stop(): Promise<void> {
    if (this.stopPromise) return this.stopPromise;
    this.stopPromise = this.stopInternal().finally(() => { this.stopPromise = undefined; });
    return this.stopPromise;
  }

  async shutdown(): Promise<void> {
    if (this.shutdownPromise) return this.shutdownPromise;
    this.shutdownRequested = true;
    this.shutdownPromise = this.stop();
    return this.shutdownPromise;
  }

  private async stopInternal(): Promise<void> {
    const child = this.process;
    this.client = undefined;
    if (!child) { this.removeRegistry(); this.setState('stopped'); return; }
    this.stopping = true;
    this.setState('stopping');
    this.log(`停止流程：PID=${child.pid ?? 'unknown'}`);
    const exited = new Promise<boolean>(resolve => {
      const timer = setTimeout(() => resolve(false), this.stopTimeoutMs);
      child.once('exit', () => { clearTimeout(timer); resolve(true); });
    });
    try {
      const client = this.client || new ApiClient(`http://127.0.0.1:${this.activePort}`, this.token);
      await this.withTimeout(client.shutdown(this.activeGeneration), Math.min(1500, this.stopTimeoutMs));
      this.log('停止流程：已请求后端优雅关闭');
    } catch (error) { this.log(`停止流程：优雅关闭不可用：${safeError(error)}`); }
    if (!await exited) {
      this.log('停止流程：优雅关闭超时，仅终止已登记的当前子进程树');
      await this.killProcess(child);
      await new Promise<void>(resolve => { const timer = setTimeout(resolve, this.stopTimeoutMs); child.once('exit', () => { clearTimeout(timer); resolve(); }); });
    }
    if (this.process === child) this.process = undefined;
    this.removeRegistry();
    this.log(`停止流程完成：PID=${child.pid ?? 'unknown'}`);
    this.setState('stopped');
  }

  private setState(state: BackendState, error?: string): void {
    this.currentState = state;
    if (error) this.lastError = error;
    const change = { state, pid: this.pid, port: this.port, error: error || this.lastError };
    this.log(`状态变化：${state}${error ? `；错误=${error}` : ''}`);
    for (const listener of this.listeners) listener(change);
  }

  private log(message: string): void { this.options.logger?.appendLine(redact(message, this.token)); }

  private registryFile(): string | undefined { return this.options.runtimeRegistryDir ? path.join(this.options.runtimeRegistryDir, `${this.extensionInstanceId}.json`) : undefined; }
  private writeRegistry(executablePath: string, pid: number | undefined, generation: number, state: 'starting' | 'healthy'): void {
    const file = this.registryFile(); if (!file || !pid) return;
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const record = { schemaVersion: 'backend-process-owner/v1', extensionInstanceId: this.extensionInstanceId, backendGeneration: generation, backendPid: pid, extensionHostPid: process.pid, executablePath, dataDirectory: this.options.dataDir, startedAt: new Date().toISOString(), lastHeartbeatAt: new Date().toISOString(), state };
      const temporary = `${file}.${process.pid}.tmp`;
      fs.writeFileSync(temporary, JSON.stringify(record), { encoding: 'utf8', mode: 0o600 }); fs.renameSync(temporary, file);
    } catch (error) { this.log(`运行时登记写入失败：${safeError(error)}`); }
  }
  private removeRegistry(): void { const file = this.registryFile(); if (!file) return; try { fs.rmSync(file, { force: true }); } catch (error) { this.log(`运行时登记清理失败：${safeError(error)}`); } }
}
