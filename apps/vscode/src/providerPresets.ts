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
    // RFC1918 / link-local — typical LAN Ollama / LM Studio hosts
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
