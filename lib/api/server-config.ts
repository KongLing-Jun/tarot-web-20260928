import { readSettings, numberSetting } from '@/scripts/config.mjs';
import type { ApiConfig } from '@/lib/tarot/types';

/** Opt-in rollout; old deployments retain their P0 behavior. */
export function getReadingPromptProfile(): 'p0' | 'p1' | 'p1-grounded' | 'p2-context' {
  const profile = readSettings().READING_PROMPT_PROFILE;
  if (profile === undefined) return 'p0';
  if (profile !== 'p0' && profile !== 'p1' && profile !== 'p1-grounded' && profile !== 'p2-context')
    throw new Error('READING_PROMPT_PROFILE 配置无效');
  return profile;
}

/** Server-only settings; never serialize this configuration to the client. */
export function getServerSetting(key: string): string {
  const config = readSettings();
  return typeof config?.[key] === 'string' ? config[key].trim() : '';
}

export function getServerNumber(key: string): number {
  return numberSetting(readSettings(), key);
}

/** Optional DeepSeek controls. Omission preserves the provider's behavior for existing deployments. */
export function getModelGenerationOptions(endpoint: string): {
  thinking?: { type: 'enabled' | 'disabled' };
  reasoning_effort?: 'low' | 'high' | 'max';
} {
  const config = readSettings();
  const thinking = config.MODEL_THINKING ?? 'provider';
  const effort = config.MODEL_REASONING_EFFORT;
  if (!['provider', 'enabled', 'disabled'].includes(thinking))
    throw new Error('MODEL_THINKING 配置无效');
  if (
    effort !== undefined &&
    (!['low', 'high', 'max'].includes(effort) || thinking !== 'enabled')
  ) {
    throw new Error('MODEL_REASONING_EFFORT 需要显式开启思考模式并使用有效档位');
  }
  if (thinking === 'provider') return {};
  // These extension fields are not part of every OpenAI-compatible provider's contract.
  if (new URL(endpoint).hostname !== 'api.deepseek.com')
    throw new Error('当前接口不支持 DeepSeek 思考配置');
  return {
    thinking: { type: thinking },
    ...(effort === undefined ? {} : { reasoning_effort: effort }),
  };
}

/** Only import from server routes. Credentials are never returned to the browser. */
export function getModelConfig(): ApiConfig | null {
  try {
    // Read on each request so edits take effect without restarting the server.
    const config = readSettings();
    const endpoint = typeof config?.MODEL_BASE_URL === 'string' ? config.MODEL_BASE_URL.trim() : '';
    const apiKey = typeof config?.MODEL_API_KEY === 'string' ? config.MODEL_API_KEY.trim() : '';
    const model = typeof config?.MODEL_ID === 'string' ? config.MODEL_ID.trim() : '';
    if (!endpoint || !apiKey || !model) return null;
    const url = new URL(endpoint);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return null;
    return { endpoint: endpoint.replace(/\/+$/, ''), apiKey, model };
  } catch {
    return null;
  }
}

/** Enable only after applying the additive intent migration. */
export function getIntentRecognitionEnabled(): boolean {
  const enabled = readSettings().INTENT_RECOGNITION_ENABLED;
  if (enabled === undefined) return false;
  if (typeof enabled !== 'boolean') throw new Error('INTENT_RECOGNITION_ENABLED 必须为布尔值');
  return enabled;
}
