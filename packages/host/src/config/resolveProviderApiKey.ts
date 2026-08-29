import { isHostProviderType, type HostProviderType } from './providerPresets.js';

export interface ResolveProviderApiKeyInput {
  type: HostProviderType | string;
  env?: NodeJS.ProcessEnv;
  /** Host SecretStorage / already-resolved secret. Wins over env. */
  secretKey?: string;
}

/**
 * Resolve a provider API key from SecretStorage then environment.
 * Never reads config files.
 */
export function resolveProviderApiKey(
  input: ResolveProviderApiKeyInput,
): string | undefined {
  const secret = input.secretKey?.trim();
  if (secret) return secret;

  const env = input.env ?? process.env;
  const generic = firstDefined(env.MITII_API_KEY);

  if (input.type === 'anthropic') {
    return firstDefined(
      env.MITII_ANTHROPIC_API_KEY,
      env.ANTHROPIC_API_KEY,
      generic,
    );
  }

  if (input.type === 'gemini') {
    return firstDefined(
      env.MITII_GEMINI_API_KEY,
      env.GEMINI_API_KEY,
      env.GOOGLE_API_KEY,
      generic,
    );
  }

  return firstDefined(generic, env.OPENAI_API_KEY);
}

export function inferHostProviderType(
  env: NodeJS.ProcessEnv = process.env,
): HostProviderType | undefined {
  const explicit = env.MITII_PROVIDER?.trim();
  if (explicit && isHostProviderType(explicit)) return explicit;
  if (env.MITII_ANTHROPIC_API_KEY || env.ANTHROPIC_API_KEY) {
    return 'anthropic';
  }
  if (env.MITII_GEMINI_API_KEY || env.GEMINI_API_KEY || env.GOOGLE_API_KEY) {
    return 'gemini';
  }
  if (env.MITII_API_KEY || env.OPENAI_API_KEY) {
    return 'openai-compatible';
  }
  return undefined;
}

function firstDefined(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) return trimmed;
  }
  return undefined;
}
