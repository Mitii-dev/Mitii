import { describe, expect, it } from 'vitest';
import { buildRuntime } from '../../../src/kernel/bootstrap';
import { ceFeatureModules } from '../../../src/features/ce/featureModules';
import { createProvider } from '../../../src/adapters/providers/createProvider';
import type { ProviderType } from '../../../src/kernel/config/schema';

/**
 * Locks in exactly which provider ids the CE `FeatureModule`s register through `buildRuntime()`,
 * cross-checked against `ProviderTypeSchema` in `kernel/config/schema.ts` (the ground truth for
 * every provider type `createProvider()` already knows how to build).
 */
describe('CE provider factory registration parity with ProviderTypeSchema', () => {
  const runtime = buildRuntime({
    features: ceFeatureModules,
    hostPorts: { workspace: { workspaceRoot: '/tmp/workspace', readText: async () => '', writeText: async () => {} } },
  });
  const ids = runtime.registries.providers.list().map((f) => f.id).sort();

  it('registers no duplicate ids', () => {
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('matches every ProviderType exactly once', () => {
    const expected = [
      'openai-compatible', 'openrouter', 'openai', 'azure-openai', 'bedrock',
      'anthropic', 'gemini', 'deepseek', 'cursor', 'codex', 'echo',
    ].sort();

    expect(ids).toEqual(expected);
  });

  it('each contribution constructs a real provider matching createProvider() output', () => {
    for (const contribution of runtime.registries.providers.list()) {
      const provider = contribution.create({ settings: {} });
      const direct = createProvider({ type: contribution.id as ProviderType });
      expect(provider.id).toBe(direct.id);
      expect(typeof provider.complete).toBe('function');
    }
  });
});
