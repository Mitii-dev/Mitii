import type { ProviderType } from '../config/schema';
import type { AgenticTier, TierPolicy } from '../agentic/tierPolicy';
import { isHostedProvider } from './hostedProvider';
import type { ModelCapabilities } from './types';

// Below this, local OpenAI-compatible models tend to need tighter prompts and fewer steps.
const LOCAL_LARGE_CONTEXT_THRESHOLD = 65_000;
// At this size, hosted models can usually carry full rules/skills plus broad retrieval.
const FRONTIER_CONTEXT_THRESHOLD = 180_000;

export function resolveAgenticTier(
  providerType: ProviderType,
  caps: Pick<ModelCapabilities, 'contextWindow' | 'supportsReasoning'> & { baseUrl?: string; model?: string }
): AgenticTier {
  const cloud = isHostedProvider(providerType, caps);
  if (!cloud) return caps.contextWindow >= LOCAL_LARGE_CONTEXT_THRESHOLD ? 'local-large' : 'local-small';
  if (caps.supportsReasoning || caps.contextWindow >= FRONTIER_CONTEXT_THRESHOLD) return 'cloud-frontier';
  return 'cloud-standard';
}

export function resolveTierPolicy(tier: AgenticTier): TierPolicy {
  switch (tier) {
    case 'local-small':
      return {
        skillInjection: 'none',
        maxSkillChars: 0,
        rulesMaxTotalChars: 6_000,
        rulesMaxCharsPerFile: 2_000,
        maxContextItems: 18,
        maxStepScale: 0.7,
        reasoningEffort: 'low',
        toolExposure: 'minimal',
      };
    case 'local-large':
      return {
        skillInjection: 'quick-ref',
        maxSkillChars: 6_000,
        rulesMaxTotalChars: 12_000,
        rulesMaxCharsPerFile: 4_000,
        maxContextItems: 40,
        maxStepScale: 0.9,
        reasoningEffort: 'low',
        toolExposure: 'standard',
      };
    case 'cloud-standard':
      return {
        skillInjection: 'full',
        maxSkillChars: 18_000,
        rulesMaxTotalChars: 20_000,
        rulesMaxCharsPerFile: 5_000,
        maxContextItems: 64,
        maxStepScale: 1,
        reasoningEffort: 'medium',
        toolExposure: 'full',
      };
    case 'cloud-frontier':
      return {
        skillInjection: 'full',
        maxSkillChars: 24_000,
        rulesMaxTotalChars: 20_000,
        rulesMaxCharsPerFile: 5_000,
        maxContextItems: 80,
        maxStepScale: 1.2,
        reasoningEffort: 'high',
        toolExposure: 'full',
      };
  }
}
