import { AiConnectionState, AiProviderProfile } from './profileStore';

export interface AiConnectionSnapshot { version: number; profileId?: string; connection: AiConnectionState; lastTest?: string; }

/** Ephemeral by design: a restarted extension must never imply a live connection. */
export class AiConnectionStateStore {
  private readonly listeners = new Set<(snapshot: AiConnectionSnapshot) => void>();
  private snapshot: AiConnectionSnapshot = { version: 0, connection: 'not-configured' };
  readonly onDidChange = (listener: (snapshot: AiConnectionSnapshot) => void): { dispose(): void } => { this.listeners.add(listener); return { dispose: () => this.listeners.delete(listener) }; };

  forProfile(profile: AiProviderProfile | undefined): AiConnectionSnapshot {
    if (!profile) return { version: this.snapshot.version, connection: 'not-configured' };
    if (this.snapshot.profileId !== profile.id) return { version: this.snapshot.version, profileId: profile.id, connection: 'not-tested' };
    return this.snapshot;
  }
  testing(profile: AiProviderProfile): void { this.set(profile.id, 'testing'); }
  connected(profile: AiProviderProfile): void { this.set(profile.id, 'connected'); }
  failed(profile: AiProviderProfile): void { this.set(profile.id, 'failed'); }
  notTested(profile: AiProviderProfile): void { this.set(profile.id, 'not-tested'); }
  private set(profileId: string, connection: AiConnectionState): void {
    this.snapshot = { version: this.snapshot.version + 1, profileId, connection, lastTest: connection === 'testing' ? this.snapshot.lastTest : new Date().toISOString() };
    this.listeners.forEach(listener => listener(this.snapshot));
  }
  dispose(): void { this.listeners.clear(); }
}
