import { describe, expect, it } from 'vitest';
import { resolveAgenticTier, resolveTierPolicy } from '../src/kernel/llm/agenticTier';
import { detectModelCapabilities } from '../src/kernel/llm/modelCapabilities';

describe('agentic tier resolver', () => {
  it('classifies local models by context size', () => {
    expect(resolveAgenticTier('openai-compatible', { contextWindow: 8192 })).toBe('local-small');
    expect(resolveAgenticTier('openai-compatible', { contextWindow: 128_000 })).toBe('local-large');
  });

  it('classifies cloud reasoning and very large-context models as frontier', () => {
    expect(resolveAgenticTier('anthropic', { contextWindow: 200_000, supportsReasoning: false })).toBe('cloud-frontier');
    expect(resolveAgenticTier('openai', { contextWindow: 128_000, supportsReasoning: true })).toBe('cloud-frontier');
  });

  it('keeps ordinary cloud models on cloud-standard', () => {
    expect(resolveAgenticTier('openai', { contextWindow: 128_000, supportsReasoning: false })).toBe('cloud-standard');
  });

  it('sets tiers on detected model capabilities', () => {
    expect(detectModelCapabilities('openai-compatible', 'qwen3-coder:30b', 8192).agenticTier).toBe('local-small');
    expect(detectModelCapabilities('anthropic', 'claude-sonnet-4-20250514', 200_000).agenticTier).toBe('cloud-frontier');
  });

  it('classifies hosted OpenAI-compatible endpoints as cloud tiers', () => {
    expect(detectModelCapabilities('openai-compatible', 'anthropic/claude-sonnet-4', 200_000, {
      baseUrl: 'https://openrouter.ai/api/v1',
    }).agenticTier).toBe('cloud-frontier');
    expect(detectModelCapabilities('openai-compatible', 'llama-3.3-70b', 128_000, {
      baseUrl: 'https://api.together.xyz/v1',
    }).agenticTier).toBe('cloud-standard');
    expect(detectModelCapabilities('openai-compatible', 'qwen3-coder:30b', 128_000, {
      baseUrl: 'http://localhost:11434/v1',
    }).agenticTier).toBe('local-large');
  });

  it('resolves tier policies with bounded skills and rules budgets', () => {
    expect(resolveTierPolicy('local-small')).toMatchObject({
      skillInjection: 'none',
      maxSkillChars: 0,
      rulesMaxTotalChars: 6_000,
    });
    expect(resolveTierPolicy('local-large')).toMatchObject({
      skillInjection: 'quick-ref',
      maxSkillChars: 6_000,
      rulesMaxCharsPerFile: 4_000,
    });
    expect(resolveTierPolicy('cloud-standard')).toMatchObject({
      skillInjection: 'full',
      maxSkillChars: 18_000,
    });
    expect(resolveTierPolicy('cloud-frontier')).toMatchObject({
      skillInjection: 'full',
      maxSkillChars: 24_000,
    });
  });
});
