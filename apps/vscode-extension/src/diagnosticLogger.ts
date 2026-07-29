import * as fs from 'node:fs';
import * as path from 'node:path';
import type { BackendLogger } from './backendProcessManager';

export interface OutputChannelLike {
  appendLine(value: string): void;
  show(preserveFocus?: boolean): void;
}

export class DiagnosticLogger implements BackendLogger {
  constructor(private readonly output: OutputChannelLike, readonly filePath: string) {}

  appendLine(value: string): void {
    const line = `[${new Date().toISOString()}] ${value}`;
    this.output.appendLine(line);
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      fs.appendFileSync(this.filePath, `${line}${process.platform === 'win32' ? '\r\n' : '\n'}`, 'utf8');
    } catch (error) {
      this.output.appendLine(`[diagnostic-log-error] ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
