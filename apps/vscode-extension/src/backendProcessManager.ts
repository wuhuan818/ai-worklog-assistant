import { randomBytes } from 'node:crypto';
import { ChildProcess, spawn, SpawnOptions } from 'node:child_process';
import { ApiClient } from './apiClient';
import { BackendState } from './backendState';

export interface BackendLogger {
  appendLine(value: string): void;
}

export interface BackendProcessManagerOptions {
  executablePath: string | (() => string);
  port: number;
  dataDir: string;
  startupTimeoutMs?: number;
  healthRequestTimeoutMs?: number;
  pollIntervalMs?: number;
  stopTimeoutMs?: number;
  logger?: BackendLogger;
  spawnProcess?: (command: string, args: string[], options: SpawnOptions) => ChildProcess;
  healthCheck?: (baseUrl: string, token: string) => Promise<void>;
  mkdir?: (directory: string) => void;
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

export class BackendProcessManager {
  private readonly token = randomBytes(24).toString('hex');
  private readonly spawnProcess: NonNullable<BackendProcessManagerOptions['spawnProcess']>;
  private readonly healthCheck: NonNullable<BackendProcessManagerOptions['healthCheck']>;
  private readonly startupTimeoutMs: number;
  private readonly healthRequestTimeoutMs: number;
  private readonly pollIntervalMs: number;
  private readonly stopTimeoutMs: number;
  private readonly listeners = new Set<Listener>();
  private process?: ChildProcess;
  private client?: ApiClient;
  private startPromise?: Promise<ApiClient>;
  private stopping = false;
  private currentState: BackendState = 'stopped';
  private lastError?: string;

  constructor(private readonly options: BackendProcessManagerOptions) {
    this.spawnProcess = options.spawnProcess || spawn;
    this.healthCheck = options.healthCheck || (async (baseUrl, token) => { await new ApiClient(baseUrl, token).health(); });
    this.startupTimeoutMs = options.startupTimeoutMs ?? 10000;
    this.healthRequestTimeoutMs = options.healthRequestTimeoutMs ?? 1000;
    this.pollIntervalMs = options.pollIntervalMs ?? 250;
    this.stopTimeoutMs = options.stopTimeoutMs ?? 3000;
  }

  get state(): BackendState { return this.currentState; }
  get pid(): number | undefined { return this.process?.pid; }
  get port(): number { return this.options.port; }
  get api(): ApiClient | undefined { return this.client; }
  get running(): boolean { return this.currentState === 'starting' || this.currentState === 'healthy'; }
  get lastErrorMessage(): string | undefined { return this.lastError; }

  onDidChangeState(listener: Listener): { dispose: () => void } {
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  }

  async start(): Promise<ApiClient> {
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

    this.log(`解析出的后端路径：${executable}`);
    this.log(`启动时间：${new Date().toISOString()}；端口：${this.options.port}`);
    try { this.options.mkdir?.(this.options.dataDir); } catch (error) { return this.fail(error); }

    let spawnError: Error | undefined;
    try {
      this.stopping = false;
      this.process = this.spawnProcess(executable, [], {
        env: {
          ...process.env,
          WORKLOG_SESSION_TOKEN: this.token,
          WORKLOG_PORT: String(this.options.port),
          WORKLOG_DATA_DIR: this.options.dataDir,
        },
        windowsHide: true,
      });
      this.process.stdout?.on('data', data => this.log(`[stdout] ${String(data).trimEnd()}`));
      this.process.stderr?.on('data', data => this.log(`[stderr] ${String(data).trimEnd()}`));
      this.process.on('error', error => {
        spawnError = error;
        this.lastError = safeError(error);
        this.log(`启动错误：${this.lastError}`);
        if (this.currentState === 'starting') this.setState('error', this.lastError);
      });
      this.process.on('exit', (code, signal) => {
        const abnormal = !this.stopping && code !== 0;
        this.log(`后端退出：退出码=${code ?? 'null'}，信号=${signal ?? 'none'}`);
        this.client = undefined;
        this.process = undefined;
        if (abnormal) this.setState('error', `后端异常退出（退出码 ${code ?? 'null'}）`);
        else if (this.currentState !== 'stopping') this.setState('stopped');
      });
    } catch (error) { return this.fail(error); }

    const baseUrl = `http://127.0.0.1:${this.options.port}`;
    const deadline = Date.now() + this.startupTimeoutMs;
    let lastError = '健康检查超时';
    while (Date.now() < deadline) {
      if (spawnError) return this.fail(spawnError);
      try {
        await this.withTimeout(this.healthCheck(baseUrl, this.token), this.healthRequestTimeoutMs);
        this.client = new ApiClient(baseUrl, this.token);
        this.log('健康检查结果：healthy');
        this.setState('healthy');
        return this.client;
      } catch (error) {
        lastError = safeError(error);
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

  async restart(): Promise<ApiClient> { await this.stop(); return this.start(); }

  async stop(): Promise<void> {
    const child = this.process;
    this.client = undefined;
    if (!child) { this.setState('stopped'); return; }
    this.stopping = true;
    this.setState('stopping');
    child.kill();
    await new Promise<void>(resolve => {
      const timer = setTimeout(resolve, this.stopTimeoutMs);
      child.once('exit', () => { clearTimeout(timer); resolve(); });
    });
    if (this.process === child) this.process = undefined;
    this.setState('stopped');
  }

  private setState(state: BackendState, error?: string): void {
    this.currentState = state;
    if (error) this.lastError = error;
    const change = { state, pid: this.pid, port: this.port, error: error || this.lastError };
    for (const listener of this.listeners) listener(change);
  }

  private log(message: string): void { this.options.logger?.appendLine(redact(message, this.token)); }
}
