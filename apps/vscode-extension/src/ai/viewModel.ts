import { AiConnectionState, AiProviderProfile, endpointSummary } from './profileStore';

export interface AiViewModel { provider: string; profile: string; model: string; thinking: string; apiKey: '已配置' | '未配置'; connection: AiConnectionState; lastTest: string; endpoint: string; workspace: string; }
export function aiViewModel(profile: AiProviderProfile | undefined, hasKey: boolean, connection: AiConnectionState = profile ? 'not-tested' : 'not-configured', lastTest?: string): AiViewModel {
  return { provider: !profile ? '未配置' : profile.provider === 'openai-compatible' ? 'Custom' : profile.provider === 'qwen' ? 'Qwen' : 'DeepSeek', profile: profile?.displayName || '-', model: profile?.model || '-', thinking: profile?.thinkingEnabled ? '开启' : '关闭', apiKey: hasKey ? '已配置' : '未配置', connection, lastTest: lastTest || '-', endpoint: profile ? endpointSummary(profile.baseUrl) : '-', workspace: profile?.workspaceId ? '已配置' : '-' };
}
