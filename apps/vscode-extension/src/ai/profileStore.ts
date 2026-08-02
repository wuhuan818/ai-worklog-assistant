import * as vscode from 'vscode';

export type AiProviderKind = 'deepseek' | 'qwen' | 'openai-compatible';
export type AiConnectionState = 'not-configured' | 'not-tested' | 'testing' | 'connected' | 'failed';
export interface AiProviderProfile { id: string; displayName: string; provider: AiProviderKind; baseUrl: string; model: string; thinkingEnabled: boolean; timeoutSeconds: number; maxOutputTokens: number; createdAt: string; updatedAt: string; }
const PROFILES_KEY = 'aiWorklog.aiProvider.profiles'; const CURRENT_KEY = 'aiWorklog.aiProvider.current';
export const secretKey = (id: string) => `aiWorklog.aiProvider.${id}.apiKey`;
export const defaultsFor = (provider: AiProviderKind) => provider === 'deepseek' ? { baseUrl: 'https://api.deepseek.com', model: 'deepseek-v4-flash' } : provider === 'qwen' ? { baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen3.7-plus' } : { baseUrl: '', model: '' };
export function endpointSummary(url: string): string { try { const value = new URL(url); return `${value.protocol}//${value.host}${value.pathname}`; } catch { return '-'; } }
export class AiProfileStore {
  constructor(private readonly state: vscode.Memento, private readonly secrets: vscode.SecretStorage) {}
  profiles(): AiProviderProfile[] { return this.state.get<AiProviderProfile[]>(PROFILES_KEY, []); }
  current(): AiProviderProfile | undefined { const id = this.state.get<string>(CURRENT_KEY); return this.profiles().find(profile => profile.id === id); }
  async save(profile: AiProviderProfile, apiKey?: string): Promise<void> { const profiles = this.profiles(); const index = profiles.findIndex(item => item.id === profile.id); if (index >= 0) profiles[index] = profile; else profiles.push(profile); await this.state.update(PROFILES_KEY, profiles); if (apiKey !== undefined && apiKey !== '') await this.secrets.store(secretKey(profile.id), apiKey); }
  async select(id: string | undefined): Promise<void> { if (id && !this.profiles().some(profile => profile.id === id)) throw new Error('AI Profile 不存在'); await this.state.update(CURRENT_KEY, id); }
  async clearKey(id: string): Promise<void> { await this.secrets.delete(secretKey(id)); }
  async delete(id: string): Promise<void> { await this.clearKey(id); await this.state.update(PROFILES_KEY, this.profiles().filter(profile => profile.id !== id)); if (this.current()?.id === id) await this.select(undefined); }
  key(id: string): Thenable<string | undefined> { return this.secrets.get(secretKey(id)); }
}
