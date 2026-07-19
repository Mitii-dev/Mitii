import { describe, expect, it } from 'vitest';
import { buildRuntime } from '../../src/kernel/bootstrap';
import type { FeatureModule } from '../../src/interfaces/feature';
import type { HostPorts } from '../../src/interfaces/runtime';

const hostPorts: HostPorts = {
  workspace: {
    workspaceRoot: '/tmp/workspace',
    readText: async () => '',
    writeText: async () => {},
  },
};

describe('buildRuntime', () => {
  it('activates features in dependency order and registers real contributions', () => {
    const activationLog: string[] = [];

    const baseFeature: FeatureModule = {
      manifest: { id: 'ce.test.base', apiVersion: '1', edition: 'ce', version: '1.0.0' },
      register(context) {
        activationLog.push('ce.test.base');
        context.tools.register({
          id: 'test_tool',
          owner: 'ce.test.base',
          create: () => ({
            descriptor: {
              id: 'test_tool',
              description: 'A test tool',
              owner: 'ce.test.base',
              source: 'builtin',
              risk: 'read',
              capabilities: [],
              inputSchema: {},
            },
            execute: async () => ({ success: true, output: 'ok' }),
          }),
        });
      },
    };

    const dependentFeature: FeatureModule = {
      manifest: {
        id: 'ce.test.dependent',
        apiVersion: '1',
        edition: 'ce',
        version: '1.0.0',
        requires: ['ce.test.base'],
      },
      register(context) {
        activationLog.push('ce.test.dependent');
        context.providers.register({
          id: 'test_provider',
          owner: 'ce.test.dependent',
          displayName: 'Test Provider',
          settingsSchema: {},
          capabilities: {},
          create: () => ({
            id: 'test_provider',
            capabilities: {
              contextWindow: 1000,
              supportsStreaming: false,
              supportsTools: false,
              supportsEmbeddings: false,
            },
            complete: async function* () {
              yield { done: true };
            },
          }),
        });
      },
    };

    const runtime = buildRuntime({
      features: [dependentFeature, baseFeature],
      hostPorts,
    });

    expect(activationLog).toEqual(['ce.test.base', 'ce.test.dependent']);
    expect(runtime.registries.tools.get('test_tool')?.owner).toBe('ce.test.base');
    expect(runtime.registries.tools.get('test_tool')?.create({}).descriptor.id).toBe('test_tool');
    expect(runtime.registries.providers.get('test_provider')?.owner).toBe('ce.test.dependent');
  });

  it('freezes every registry after activation so late registration throws', () => {
    const feature: FeatureModule = {
      manifest: { id: 'ce.test.solo', apiVersion: '1', edition: 'ce', version: '1.0.0' },
      register() {},
    };

    const runtime = buildRuntime({ features: [feature], hostPorts });

    expect(() =>
      runtime.registries.commands.register({ id: 'late.command', owner: 'ce.test.solo', title: 'Late' })
    ).toThrow(/frozen/i);
  });

  it('surfaces missing dependencies instead of silently dropping a feature', () => {
    const feature: FeatureModule = {
      manifest: {
        id: 'ce.test.broken',
        apiVersion: '1',
        edition: 'ce',
        version: '1.0.0',
        requires: ['ce.test.missing'],
      },
      register() {},
    };

    expect(() => buildRuntime({ features: [feature], hostPorts })).toThrow(/missing feature/i);
  });
});
