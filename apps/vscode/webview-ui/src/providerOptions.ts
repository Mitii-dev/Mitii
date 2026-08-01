/** Webview-local presets (mirrors @mitii/host provider presets). */

export const PROVIDER_OPTIONS = [
  { type: 'echo', preset: 'echo', label: 'Echo (local stub)', baseUrl: '', model: 'echo' },
  {
    type: 'openai-compatible',
    preset: 'ollama',
    label: 'Ollama (local)',
    baseUrl: 'http://localhost:11434/v1',
    model: 'qwen3-coder:30b',
  },
  {
    type: 'openai-compatible',
    preset: 'lm-studio',
    label: 'LM Studio (local)',
    baseUrl: 'http://localhost:1234/v1',
    model: 'local-model',
  },
  {
    type: 'openai-compatible',
    preset: 'openai',
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
  },
  {
    type: 'openai-compatible',
    preset: 'openrouter',
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'openai/gpt-4o-mini',
  },
  {
    type: 'openai-compatible',
    preset: 'deepseek',
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
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
    model: 'qwen3-coder:30b',
  },
] as const;

export const LOCAL_MODEL_OPTIONS = [
  'qwen3-coder:30b',
  'qwen3.5:latest',
  'qwen3.5:9b',
  'qwen3.5:4b',
  'devstral-small-2:24b',
  'codestral:22b',
  'deepseek-coder:33b-instruct-q4_0',
  'gemma4:latest',
  'gemma4:12b',
  'llama3.2:latest',
  'mistral:latest',
] as const;

export function getProviderPreset(typeOrPreset: string) {
  return (
    PROVIDER_OPTIONS.find((p) => p.preset === typeOrPreset) ??
    PROVIDER_OPTIONS.find((p) => p.type === typeOrPreset)
  );
}
