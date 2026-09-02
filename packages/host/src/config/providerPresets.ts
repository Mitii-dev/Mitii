import type { OpenAiCompatibleAuthHeader } from '@mitii/sdk';

/**
 * UI / config preset id. `type` selects the host-constructed LlmPort adapter.
 * Secrets never live in presets.
 */
export type HostProviderType =
  | 'echo'
  | 'openai-compatible'
  | 'anthropic'
  | 'gemini';

export type ProviderPresetId =
  | 'echo'
  | 'ollama'
  | 'ollama-cloud'
  | 'lm-studio'
  | 'openai'
  | 'openrouter'
  | 'deepseek'
  | 'azure-openai'
  | 'openai-compatible'
  | 'anthropic'
  | 'gemini';

export interface ProviderPreset {
  id: ProviderPresetId;
  /** Persisted mitii.provider.type / CLI provider field. */
  type: HostProviderType;
  label: string;
  baseUrl: string;
  model: string;
  models?: readonly string[];
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
    model: '',
    requiresApiKey: false,
    notes: 'Pick a model after Test connection lists /v1/models.',
  },
  {
    id: 'ollama-cloud',
    type: 'openai-compatible',
    label: 'Ollama Cloud',
    baseUrl: 'https://ollama.com/v1',
    model: '',
    requiresApiKey: true,
    notes:
      'Cloud models at ollama.com. Set an API key, then Test connection to list models.',
  },
  {
    id: 'lm-studio',
    type: 'openai-compatible',
    label: 'LM Studio (local)',
    baseUrl: 'http://localhost:1234/v1',
    model: '',
    requiresApiKey: false,
    notes: 'Pick a model after Test connection lists /v1/models.',
  },
  {
    id: 'openai',
    type: 'openai-compatible',
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    models: ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1', 'o4-mini'],
    requiresApiKey: true,
  },
  {
    id: 'openrouter',
    type: 'openai-compatible',
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'openai/gpt-4o-mini',
    models: [
      'openai/gpt-4o-mini',
      'anthropic/claude-sonnet-4',
      'google/gemini-2.5-flash',
    ],
    requiresApiKey: true,
    notes: 'Route Claude, Gemini, and other vendors through one OpenAI-compatible key.',
  },
  {
    id: 'deepseek',
    type: 'openai-compatible',
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    models: ['deepseek-chat', 'deepseek-reasoner'],
    requiresApiKey: true,
  },
  {
    id: 'azure-openai',
    type: 'openai-compatible',
    label: 'Azure OpenAI',
    baseUrl:
      'https://YOUR_RESOURCE.openai.azure.com/openai/deployments/YOUR_DEPLOYMENT',
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
    model: '',
    requiresApiKey: false,
    notes: 'Any OpenAI-compatible /v1 chat completions endpoint. Pick a model after Test connection.',
  },
  {
    id: 'anthropic',
    type: 'anthropic',
    label: 'Anthropic (Claude)',
    baseUrl: 'https://api.anthropic.com',
    model: 'claude-sonnet-4-5',
    models: [
      'claude-sonnet-4-5',
      'claude-opus-4-1',
      'claude-haiku-4-5',
    ],
    requiresApiKey: true,
    notes: 'Native Anthropic Messages API. API key from console.anthropic.com.',
  },
  {
    id: 'gemini',
    type: 'gemini',
    label: 'Google Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com',
    model: 'gemini-2.5-flash',
    models: ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash'],
    requiresApiKey: true,
    notes: 'Native Gemini generateContent API. API key from Google AI Studio.',
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

export function isHostProviderType(value: string): value is HostProviderType {
  return (
    value === 'echo' ||
    value === 'openai-compatible' ||
    value === 'anthropic' ||
    value === 'gemini'
  );
}

export function isOllamaBaseUrl(baseUrl?: string): boolean {
  if (!baseUrl?.trim()) return false;
  try {
    const url = new URL(baseUrl);
    if (url.hostname.toLowerCase().includes('ollama')) return true;
    return url.port === '11434';
  } catch {
    return /11434|\bollama\b/i.test(baseUrl);
  }
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
