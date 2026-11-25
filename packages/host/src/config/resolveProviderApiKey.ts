import { isHostProviderType, type HostProviderType } from './providerPresets.js';

export interface ResolveProviderApiKeyInput {
  type: HostProviderType | string;
  /** Optional preset id (grok, deepseek, …) for provider-specific env keys. */
  preset?: string;
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
  const preset = (input.preset ?? '').trim().toLowerCase();

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

  // OpenAI-compatible family — prefer preset-specific env, then common keys.
  const byPreset = resolveOpenAiCompatiblePresetKey(preset, env);
  if (byPreset) return byPreset;

  return firstDefined(
    generic,
    env.OPENAI_API_KEY,
    env.OPENROUTER_API_KEY,
    env.DEEPSEEK_API_KEY,
    env.XAI_API_KEY,
    env.GROK_API_KEY,
    env.GROQ_API_KEY,
    env.MISTRAL_API_KEY,
    env.TOGETHER_API_KEY,
    env.FIREWORKS_API_KEY,
  );
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
  if (
    env.MITII_API_KEY ||
    env.OPENAI_API_KEY ||
    env.OPENROUTER_API_KEY ||
    env.DEEPSEEK_API_KEY ||
    env.XAI_API_KEY ||
    env.GROK_API_KEY ||
    env.GROQ_API_KEY ||
    env.MISTRAL_API_KEY ||
    env.TOGETHER_API_KEY ||
    env.FIREWORKS_API_KEY
  ) {
    return 'openai-compatible';
  }
  return undefined;
}

function resolveOpenAiCompatiblePresetKey(
  preset: string,
  env: NodeJS.ProcessEnv,
): string | undefined {
  switch (preset) {
    case 'openai':
      return firstDefined(env.MITII_OPENAI_API_KEY, env.OPENAI_API_KEY);
    case 'openrouter':
      return firstDefined(env.MITII_OPENROUTER_API_KEY, env.OPENROUTER_API_KEY);
    case 'deepseek':
      return firstDefined(env.MITII_DEEPSEEK_API_KEY, env.DEEPSEEK_API_KEY);
    case 'grok':
    case 'xai':
      return firstDefined(
        env.MITII_XAI_API_KEY,
        env.MITII_GROK_API_KEY,
        env.XAI_API_KEY,
        env.GROK_API_KEY,
      );
    case 'groq':
      return firstDefined(env.MITII_GROQ_API_KEY, env.GROQ_API_KEY);
    case 'mistral':
      return firstDefined(env.MITII_MISTRAL_API_KEY, env.MISTRAL_API_KEY);
    case 'together':
      return firstDefined(env.MITII_TOGETHER_API_KEY, env.TOGETHER_API_KEY);
    case 'fireworks':
      return firstDefined(env.MITII_FIREWORKS_API_KEY, env.FIREWORKS_API_KEY);
    case 'azure-openai':
      return firstDefined(
        env.MITII_AZURE_OPENAI_API_KEY,
        env.AZURE_OPENAI_API_KEY,
        env.OPENAI_API_KEY,
      );
    default:
      return undefined;
  }
}

function firstDefined(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) return trimmed;
  }
  return undefined;
}
