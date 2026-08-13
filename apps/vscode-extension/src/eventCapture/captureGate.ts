/**
 * Independent capture switches. Enabling capture must never override a
 * lifecycle pause; only an explicit resume may release that lock.
 */
export class CaptureGate {
  private captureEnabled = false;
  private capturePaused = false;

  get enabled(): boolean { return this.captureEnabled; }
  get paused(): boolean { return this.capturePaused; }
  get accepting(): boolean { return this.captureEnabled && !this.capturePaused; }

  setEnabled(value: boolean): void { this.captureEnabled = value; }
  pause(): void { this.capturePaused = true; }
  resume(): void { this.capturePaused = false; }
}
