export interface ProviderPreset {
  type: 'echo' | 'openai-compatible';
  label: string;
  baseUrl: string;
  model: string;
  requiresApiKey: boolean;
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    type: 'echo',
    label: 'Echo (local stub)',
    baseUrl: '',
    model: 'echo',
    requiresApiKey: false,
  },
  {
    type: 'openai-compatible',
    label: 'OpenAI-compatible (Ollama, LM Studio)',
    baseUrl: 'http://localhost:11434/v1',
    model: 'qwen3-coder:30b',
    requiresApiKey: false,
  },
];

export function getProviderPreset(
  type: string,
): ProviderPreset | undefined {
  return PROVIDER_PRESETS.find((p) => p.type === type);
}

export function isLocalBaseUrl(baseUrl?: string): boolean {
  if (!baseUrl?.trim()) return false;
  try {
    const host = new URL(baseUrl).hostname.toLowerCase();
    return (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '::1' ||
      host.endsWith('.local')
    );
  } catch {
    return /localhost|127\.0\.0\.1/i.test(baseUrl);
  }
}
