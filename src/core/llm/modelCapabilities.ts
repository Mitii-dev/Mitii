import type { ProviderType } from '../config/schema';
import type { ModelCapabilities } from './types';
import { resolveAgenticTier } from './agenticTier';
export { isHostedProvider } from './hostedProvider';

export interface CapabilityOverride {
  contextWindow?: number;
  supportsStreaming?: boolean;
  supportsTools?: boolean;
  supportsEmbeddings?: boolean;
  supportsVision?: boolean;
  supportsReasoning?: boolean;
}

export function detectModelCapabilities(
  providerType: ProviderType,
  model: string,
  presetContextWindow = 8192,
  override: CapabilityOverride & { baseUrl?: string } = {}
): ModelCapabilities {
  const { baseUrl, ...capabilityOverride } = override;
  const normalized = model.toLowerCase();
  const base: ModelCapabilities = {
    contextWindow: presetContextWindow,
    supportsStreaming: providerType !== 'echo',
    supportsTools: providerType !== 'echo' && providerType !== 'bedrock',
    supportsEmbeddings: false,
    supportsVision: false,
    supportsReasoning: false,
  };

  if (providerType === 'echo') {
    base.supportsStreaming = true;
    base.supportsTools = false;
  }

  if (providerType === 'gemini') {
    base.supportsVision = true;
    base.supportsReasoning = /thinking|2\.5|pro/.test(normalized);
  }

  if (providerType === 'anthropic' || providerType === 'bedrock') {
    base.supportsVision = /claude|sonnet|opus|haiku/.test(normalized);
  }

  if (providerType === 'openai' || providerType === 'openrouter' || providerType === 'codex') {
    base.supportsVision = /gpt-4o|gpt-4\.1|o[134]|vision|claude|gemini|sonnet|opus/i.test(model);
    base.supportsReasoning = /(^|[\/-])o[134]($|[-.])|reason|thinking|sonnet-4|claude-3\.7|claude-sonnet-4/i.test(model);
  }

  if (providerType === 'deepseek') {
    base.supportsReasoning = /reasoner|r1/.test(normalized);
  }

  if (providerType === 'openai-compatible' || providerType === 'cursor') {
    base.supportsVision = /vision|vl|gpt-4o|gpt-4\.1|llava|qwen.*vl|gemini|claude/.test(normalized);
    base.supportsReasoning = /reason|thinking|r1|qwen3|o[134]/.test(normalized);
  }

  const withTier = {
    ...base,
    ...definedOnly(capabilityOverride),
    contextWindow: capabilityOverride.contextWindow ?? base.contextWindow,
  };
  return {
    ...withTier,
    agenticTier: resolveAgenticTier(providerType, {
      ...withTier,
      model,
      baseUrl,
    }),
  };
}


function definedOnly<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, nested]) => nested !== undefined)
  ) as Partial<T>;
}
