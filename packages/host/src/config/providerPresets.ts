import type { OpenAiCompatibleAuthHeader } from '@mitii/sdk';

/**
 * UI / config preset id. All non-echo presets use OpenAiCompatibleLlmPort.
 * `provider.type` in hosts remains `echo` | `openai-compatible` for settings
 * persistence; presets only prefill base URL, model, and auth style.
 */
export type ProviderPresetId =
  | 'echo'
  | 'ollama'
  | 'lm-studio'
  | 'openai'
  | 'openrouter'
  | 'deepseek'
  | 'azure-openai'
  | 'openai-compatible';

export interface ProviderPreset {
  id: ProviderPresetId;
  /** Persisted mitii.provider.type / CLI provider field. */
  type: 'echo' | 'openai-compatible';
  label: string;
  baseUrl: string;
  model: string;
  requiresApiKey: boolean;
  authHeader?: OpenAiCompatibleAuthHeader;
  chatCompletionsPath?: string;
  notes?: string;
}

export const PROVIDER_PRESETS: readonly ProviderPreset[] = [
  {
    id: 'echo',
    type: 'echo',
    label: 'Echo (local stub)',
    baseUrl: '',
    model: 'echo',
    requiresApiKey: false,
    notes: 'Offline deterministic stub for smoke tests.',
  },
  {
    id: 'ollama',
    type: 'openai-compatible',
    label: 'Ollama (local)',
    baseUrl: 'http://localhost:11434/v1',
    model: 'qwen3-coder:30b',
    requiresApiKey: false,
  },
  {
    id: 'lm-studio',
    type: 'openai-compatible',
    label: 'LM Studio (local)',
    baseUrl: 'http://localhost:1234/v1',
    model: 'local-model',
    requiresApiKey: false,
  },
  {
    id: 'openai',
    type: 'openai-compatible',
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    requiresApiKey: true,
  },
  {
    id: 'openrouter',
    type: 'openai-compatible',
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'openai/gpt-4o-mini',
    requiresApiKey: true,
  },
  {
    id: 'deepseek',
    type: 'openai-compatible',
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    requiresApiKey: true,
  },
  {
    id: 'azure-openai',
    type: 'openai-compatible',
    label: 'Azure OpenAI',
    baseUrl: 'https://YOUR_RESOURCE.openai.azure.com/openai/deployments/YOUR_DEPLOYMENT',
    model: 'gpt-4o-mini',
    requiresApiKey: true,
    authHeader: 'api-key',
    chatCompletionsPath: 'chat/completions?api-version=2024-06-01',
    notes: 'Replace resource/deployment in base URL; uses api-key auth.',
  },
  {
    id: 'openai-compatible',
    type: 'openai-compatible',
    label: 'Custom OpenAI-compatible',
    baseUrl: 'http://localhost:11434/v1',
    model: 'qwen3-coder:30b',
    requiresApiKey: false,
    notes: 'Any OpenAI-compatible /v1 chat completions endpoint.',
  },
] as const;

export function getProviderPreset(
  idOrType: string,
): ProviderPreset | undefined {
  return (
    PROVIDER_PRESETS.find((p) => p.id === idOrType) ??
    PROVIDER_PRESETS.find((p) => p.type === idOrType)
  );
}

export function isLocalBaseUrl(baseUrl?: string): boolean {
  if (!baseUrl?.trim()) return false;
  try {
    const host = new URL(baseUrl).hostname.toLowerCase();
    if (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '::1' ||
      host === '0.0.0.0' ||
      host === 'host.docker.internal' ||
      host.endsWith('.local') ||
      host.endsWith('.localhost')
    ) {
      return true;
    }
    if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
    if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
    if (/^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
    if (/^169\.254\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
    return false;
  } catch {
    return /localhost|127\.0\.0\.1|0\.0\.0\.0|host\.docker\.internal|\.local\b/i.test(
      baseUrl,
    );
  }
}
