import type { ProviderType } from '../config/schema';

const LOCAL_OPENAI_COMPAT_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  '::1',
  '0.0.0.0',
  'host.docker.internal',
]);

const HOSTED_OPENAI_COMPAT_HOST_PATTERNS = [
  /(^|\.)openrouter\.ai$/i,
  /(^|\.)together\.xyz$/i,
  /(^|\.)groq\.com$/i,
  /(^|\.)fireworks\.ai$/i,
  /(^|\.)deepinfra\.com$/i,
  /(^|\.)novita\.ai$/i,
  /(^|\.)perplexity\.ai$/i,
  /(^|\.)mistral\.ai$/i,
  /(^|\.)anyscale\.com$/i,
  /(^|\.)x\.ai$/i,
  /(^|\.)openai\.com$/i,
  /(^|\.)azure\.com$/i,
  /(^|\.)azure\.com\.cn$/i,
];

const HOSTED_MODEL_PATTERNS =
  /\b(gpt-|o[134]\b|claude|sonnet|opus|haiku|gemini|llama-4|mixtral|mistral-large|grok|command-r|deepseek-(chat|reasoner|r1)|kimi|qwen3-235b)\b/i;

export function isHostedProvider(
  providerType: ProviderType,
  details: { baseUrl?: string; model?: string; contextWindow?: number; supportsReasoning?: boolean } = {}
): boolean {
  if (providerType === 'echo') return false;
  if (providerType !== 'openai-compatible') return true;

  const hostname = parseHostname(details.baseUrl);
  if (hostname) {
    if (LOCAL_OPENAI_COMPAT_HOSTS.has(hostname) || hostname.endsWith('.local')) return false;
    if (HOSTED_OPENAI_COMPAT_HOST_PATTERNS.some((pattern) => pattern.test(hostname))) return true;
    return !isPrivateNetworkHost(hostname);
  }

  const model = details.model?.trim() ?? '';
  if (HOSTED_MODEL_PATTERNS.test(model)) return true;
  if ((details.contextWindow ?? 0) >= 180_000) return true;
  return false;
}

function parseHostname(baseUrl?: string): string | undefined {
  if (!baseUrl?.trim()) return undefined;
  try {
    return new URL(baseUrl).hostname.toLowerCase();
  } catch {
    return undefined;
  }
}

function isPrivateNetworkHost(hostname: string): boolean {
  if (/^10\./.test(hostname)) return true;
  if (/^192\.168\./.test(hostname)) return true;
  const match = hostname.match(/^172\.(\d{1,3})\./);
  if (match) {
    const octet = Number(match[1]);
    return octet >= 16 && octet <= 31;
  }
  return false;
}
