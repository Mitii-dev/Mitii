/** Webview-local presets (mirrors host providerPresets / modelPresets). */

export const PROVIDER_OPTIONS = [
  { type: 'echo', label: 'Echo (local stub)', baseUrl: '', model: 'echo' },
  {
    type: 'openai-compatible',
    label: 'OpenAI-compatible (Ollama, LM Studio)',
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

export function getProviderPreset(type: string) {
  return PROVIDER_OPTIONS.find((p) => p.type === type);
}
