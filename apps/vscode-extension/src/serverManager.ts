import * as path from 'path';
import * as crypto from 'crypto';
import * as vscode from 'vscode';
import { ChildProcess, spawn } from 'child_process';
import { ApiClient } from './apiClient';

export class ServerManager {
  private process?: ChildProcess;
  private readonly token = crypto.randomBytes(24).toString('hex');
  private client?: ApiClient;

  constructor(private readonly context: vscode.ExtensionContext) {}

  get api(): ApiClient | undefined { return this.client; }
  get running(): boolean { return !!this.process && !this.process.killed; }

  async start(): Promise<ApiClient> {
    if (this.client) { await this.client.health(); return this.client; }
    const config = vscode.workspace.getConfiguration('aiWorklog');
    const port = config.get<number>('serverPort', 8765);
    const executable = config.get<string>('serverPath', '') || path.join(this.context.extensionPath, 'server', 'ai-worklog-server.exe');
    const dataDir = config.get<string>('dataDir', '') || path.join(process.env.LOCALAPPDATA || this.context.extensionPath, 'AIWorklogAssistant');
    this.process = spawn(executable, [], { env: { ...process.env, WORKLOG_SESSION_TOKEN: this.token, WORKLOG_PORT: String(port), WORKLOG_DATA_DIR: dataDir }, windowsHide: true });
    this.process.on('exit', () => { this.client = undefined; this.process = undefined; });
    this.process.on('error', () => { this.client = undefined; });
    const client = new ApiClient(`http://127.0.0.1:${port}`, this.token);
    const deadline = Date.now() + 10000;
    let lastError: unknown;
    while (Date.now() < deadline) {
      try { await client.health(); this.client = client; return client; }
      catch (error) { lastError = error; await new Promise(resolve => setTimeout(resolve, 250)); }
    }
    await this.stop();
    throw new Error(`本地后端启动失败：${lastError instanceof Error ? lastError.message : String(lastError)}`);
  }

  async restart(): Promise<ApiClient> { await this.stop(); return this.start(); }
  async stop(): Promise<void> {
    const child = this.process; this.client = undefined; this.process = undefined;
    if (!child || child.killed) return;
    child.kill();
    await new Promise<void>(resolve => { const timer = setTimeout(resolve, 2000); child.once('exit', () => { clearTimeout(timer); resolve(); }); });
  }
}
