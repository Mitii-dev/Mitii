/** Webview-local presets (mirrors @mitii/host provider presets). */

export const PROVIDER_OPTIONS = [
  { type: 'echo', preset: 'echo', label: 'Echo (local stub)', baseUrl: '', model: 'echo' },
  {
    type: 'openai-compatible',
    preset: 'ollama',
    label: 'Ollama (local)',
    baseUrl: 'http://localhost:11434/v1',
    model: '',
  },
  {
    type: 'openai-compatible',
    preset: 'ollama-cloud',
    label: 'Ollama Cloud',
    baseUrl: 'https://ollama.com/v1',
    model: '',
  },
  {
    type: 'openai-compatible',
    preset: 'lm-studio',
    label: 'LM Studio (local)',
    baseUrl: 'http://localhost:1234/v1',
    model: '',
  },
  {
    type: 'openai-compatible',
    preset: 'openai',
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    models: ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1', 'o4-mini'],
  },
  {
    type: 'openai-compatible',
    preset: 'openrouter',
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'openai/gpt-4o-mini',
    models: [
      'openai/gpt-4o-mini',
      'anthropic/claude-sonnet-4',
      'google/gemini-2.5-flash',
    ],
  },
  {
    type: 'openai-compatible',
    preset: 'deepseek',
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    models: ['deepseek-chat', 'deepseek-reasoner'],
  },
  {
    type: 'openai-compatible',
    preset: 'azure-openai',
    label: 'Azure OpenAI',
    baseUrl:
      'https://YOUR_RESOURCE.openai.azure.com/openai/deployments/YOUR_DEPLOYMENT',
    model: 'gpt-4o-mini',
  },
  {
    type: 'openai-compatible',
    preset: 'openai-compatible',
    label: 'Custom OpenAI-compatible',
    baseUrl: 'http://localhost:11434/v1',
    model: '',
  },
  {
    type: 'anthropic',
    preset: 'anthropic',
    label: 'Anthropic (Claude)',
    baseUrl: 'https://api.anthropic.com',
    model: 'claude-sonnet-4-5',
    models: ['claude-sonnet-4-5', 'claude-opus-4-1', 'claude-haiku-4-5'],
  },
  {
    type: 'gemini',
    preset: 'gemini',
    label: 'Google Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com',
    model: 'gemini-2.5-flash',
    models: ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash'],
  },
] as const;

export function getProviderPreset(typeOrPreset: string) {
  return (
    PROVIDER_OPTIONS.find((p) => p.preset === typeOrPreset) ??
    PROVIDER_OPTIONS.find((p) => p.type === typeOrPreset)
  );
}

/**
 * Curated cloud catalog only — local/Ollama models come from Test connection /
 * /v1/models discovery, never a hardcoded list.
 */
export function modelsForProvider(typeOrPreset: string): string[] {
  const preset = getProviderPreset(typeOrPreset);
  if (preset && 'models' in preset && preset.models) {
    return [...preset.models];
  }
  return [];
}
