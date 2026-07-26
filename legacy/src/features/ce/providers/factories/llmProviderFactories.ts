import { zodToJsonSchema } from 'zod-to-json-schema';
import type { LlmProviderContribution, ProviderFactoryContext, LlmProvider } from '../../../../interfaces/llm';
import type { JsonSchema } from '../../../../interfaces/shared/json';
import type { ProviderType } from '../../../../kernel/config/schema';
import { ProviderConfigSchema } from '../../../../kernel/config/schema';
import { getProviderPreset } from '../../../../kernel/llm/providerPresets';
import { createProvider, type ProviderResolveOptions } from '../../../../adapters/providers/createProvider';

const OWNER = 'ce.providers';

// `ProviderConfigSchema` uses `apiKeyRef` (a settings-storage pointer); the actual key material
// flows through `ProviderFactoryContext.apiKey` at create-time instead, matching `createProvider`.
const SETTINGS_SCHEMA = zodToJsonSchema(ProviderConfigSchema.omit({ type: true })) as JsonSchema;

function providerContribution(type: ProviderType, displayName: string): LlmProviderContribution {
  const preset = getProviderPreset(type);
  return {
    id: type,
    owner: OWNER,
    displayName,
    settingsSchema: SETTINGS_SCHEMA,
    capabilities: {
      contextWindow: preset?.contextWindow ?? 8192,
      supportsStreaming: type !== 'echo',
      supportsTools: type !== 'echo' && type !== 'bedrock',
      supportsEmbeddings: false,
    },
    create(context: ProviderFactoryContext): LlmProvider {
      const settings = (context.settings ?? {}) as Partial<ProviderResolveOptions>;
      return createProvider({ ...settings, type }, context.apiKey);
    },
  };
}

/**
 * Real `LlmProviderContribution`s — wraps `createProvider()` (the existing config-driven factory
 * switch in `adapters/providers/createProvider.ts`), doesn't reimplement provider construction.
 * One contribution per `ProviderType`, matching `kernel/config/schema.ts`'s `ProviderTypeSchema`
 * exactly so ids stay in sync with what `ProviderConfig.type` already accepts everywhere else.
 *
 * `interfaces/llm/LlmProvider` and `kernel/llm/types.ts`'s `LlmProvider` are two distinct type
 * declarations (the migration plan doc flags unifying them as follow-up); `createProvider()`
 * returns the latter. They're structurally compatible today — every field the interfaces contract
 * requires is present with the same optionality in the kernel contract, so no cast or shape
 * conversion is needed here. If either type gains an incompatible field this file's `create()`
 * return type will fail to typecheck.
 */
export const llmProviderFactories: readonly LlmProviderContribution[] = [
  providerContribution('openai-compatible', 'OpenAI-compatible (Ollama, LM Studio)'),
  providerContribution('openrouter', 'OpenRouter'),
  providerContribution('openai', 'OpenAI'),
  providerContribution('azure-openai', 'Azure OpenAI'),
  providerContribution('bedrock', 'AWS Bedrock'),
  providerContribution('anthropic', 'Anthropic (Claude)'),
  providerContribution('gemini', 'Google Gemini'),
  providerContribution('deepseek', 'DeepSeek'),
  providerContribution('cursor', 'Cursor'),
  providerContribution('codex', 'OpenAI Codex'),
  providerContribution('echo', 'Echo (offline/testing)'),
];
