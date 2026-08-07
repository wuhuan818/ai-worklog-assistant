import * as vscode from 'vscode';

export type AiProviderKind = 'deepseek' | 'qwen' | 'openai-compatible';
export type QwenRegion = 'beijing' | 'singapore' | 'tokyo' | 'frankfurt' | 'virginia' | 'custom';
export type AiConnectionState = 'not-configured' | 'not-tested' | 'testing' | 'connected' | 'failed';
export interface AiProviderProfile { id: string; displayName: string; provider: AiProviderKind; baseUrl: string; model: string; thinkingEnabled: boolean; timeoutSeconds: number; maxOutputTokens: number; createdAt: string; updatedAt: string; qwenRegion?: QwenRegion; workspaceId?: string; }
const PROFILES_KEY = 'aiWorklog.aiProvider.profiles'; const CURRENT_KEY = 'aiWorklog.aiProvider.current';
export const minimumStructuredOutputTokens = 2048;
export const secretKey = (id: string) => `aiWorklog.aiProvider.${id}.apiKey`;
export const defaultsFor = (provider: AiProviderKind) => provider === 'deepseek' ? { baseUrl: 'https://api.deepseek.com', model: 'deepseek-v4-flash' } : provider === 'qwen' ? { baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen3.7-plus' } : { baseUrl: '', model: '' };
export const qwenRegionOptions: ReadonlyArray<{ label: string; region: QwenRegion; baseUrl: string; requiresWorkspaceId: boolean }> = [
  { label: '中国北京', region: 'beijing', baseUrl: '', requiresWorkspaceId: true },
  { label: '新加坡', region: 'singapore', baseUrl: '', requiresWorkspaceId: true },
  { label: '日本东京', region: 'tokyo', baseUrl: '', requiresWorkspaceId: true },
  { label: '德国法兰克福', region: 'frankfurt', baseUrl: '', requiresWorkspaceId: true },
  { label: '美国弗吉尼亚', region: 'virginia', baseUrl: 'https://dashscope-us.aliyuncs.com/compatible-mode/v1', requiresWorkspaceId: false },
  { label: '自定义', region: 'custom', baseUrl: '', requiresWorkspaceId: false },
];
const qwenWorkspaceHosts: Record<Exclude<QwenRegion, 'virginia' | 'custom'>, string> = { beijing: 'cn-beijing.maas.aliyuncs.com', singapore: 'ap-southeast-1.maas.aliyuncs.com', tokyo: 'ap-northeast-1.maas.aliyuncs.com', frankfurt: 'eu-central-1.maas.aliyuncs.com' };
export function qwenWorkspaceBaseUrl(region: QwenRegion, workspaceId?: string): string {
  if (region === 'virginia') return 'https://dashscope-us.aliyuncs.com/compatible-mode/v1';
  if (region === 'custom') return '';
  const id = workspaceId?.trim(); if (!id || !/^[a-zA-Z0-9-]+$/.test(id)) throw new Error('Workspace ID format is invalid');
  return `https://${id}.${qwenWorkspaceHosts[region]}/compatible-mode/v1`;
}
export function endpointSummary(url: string): string { try { const value = new URL(url); const host = value.hostname.endsWith('.maas.aliyuncs.com') ? `<workspace>.${value.hostname.split('.').slice(1).join('.')}` : value.host; return `${value.protocol}//${host}${value.pathname}`; } catch { return '-'; } }
export class AiProfileStore {
  constructor(private readonly state: vscode.Memento, private readonly secrets: vscode.SecretStorage) {}
  profiles(): AiProviderProfile[] { return this.state.get<AiProviderProfile[]>(PROFILES_KEY, []).map(profile => ({ ...profile, maxOutputTokens: Math.max(profile.maxOutputTokens || 0, minimumStructuredOutputTokens) })); }
  current(): AiProviderProfile | undefined { const id = this.state.get<string>(CURRENT_KEY); return this.profiles().find(profile => profile.id === id); }
  async save(profile: AiProviderProfile, apiKey?: string): Promise<void> { const profiles = this.profiles(); const index = profiles.findIndex(item => item.id === profile.id); if (index < 0 && profiles.some(item => item.id === profile.id)) throw new Error('重复的 AI Profile ID'); if (index >= 0) profiles[index] = profile; else profiles.push(profile); await this.state.update(PROFILES_KEY, profiles); if (apiKey !== undefined && apiKey !== '') await this.secrets.store(secretKey(profile.id), apiKey); }
  async select(id: string | undefined): Promise<void> { if (id && !this.profiles().some(profile => profile.id === id)) throw new Error('AI Profile 不存在'); await this.state.update(CURRENT_KEY, id); }
  async clearKey(id: string): Promise<void> { await this.secrets.delete(secretKey(id)); }
  async delete(id: string): Promise<void> { await this.clearKey(id); await this.state.update(PROFILES_KEY, this.profiles().filter(profile => profile.id !== id)); if (this.current()?.id === id) await this.select(undefined); }
  key(id: string): Thenable<string | undefined> { return this.secrets.get(secretKey(id)); }
}
export interface EmbeddingProfile { id:string; name:string; kind:'qwen'|'openai-compatible'; baseUrl:string; model:string; dimensions?:number; timeoutSeconds:number; enabled:boolean; }
const EMBEDDING_KEY='aiWorklog.embedding.profile'; const embeddingSecretKey=(id:string)=>`aiWorklog.embedding.${id}.apiKey`;
export class EmbeddingProfileStore {
  constructor(private readonly state:vscode.Memento,private readonly secrets:vscode.SecretStorage){}
  current():EmbeddingProfile|undefined{return this.state.get<EmbeddingProfile>(EMBEDDING_KEY);}
  async save(profile:EmbeddingProfile,key?:string):Promise<void>{await this.state.update(EMBEDDING_KEY,profile);if(key)await this.secrets.store(embeddingSecretKey(profile.id),key);}
  key(id:string):Thenable<string|undefined>{return this.secrets.get(embeddingSecretKey(id));}
  async clear():Promise<void>{const current=this.current();if(current)await this.secrets.delete(embeddingSecretKey(current.id));await this.state.update(EMBEDDING_KEY,undefined);}
}
