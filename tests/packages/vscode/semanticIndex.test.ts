import { describe, expect, it } from 'vitest';

import { resolveVsCodeSemanticIndexSettings } from '../../../apps/vscode/src/semanticIndex';

function vsCodeMock(values: Record<string, unknown> = {}) {
  return {
    workspace: {
      getConfiguration: () => ({
        get: <T>(key: string) => values[key] as T | undefined,
        inspect: <T>(key: string) => {
          if (!Object.prototype.hasOwnProperty.call(values, key)) {
            return { key: `mitii.${key}`, defaultValue: undefined as T };
          }
          return {
            key: `mitii.${key}`,
            workspaceValue: values[key] as T,
          };
        },
      }),
    },
  };
}

const secrets = {
  get: async () => undefined,
};

describe('VS Code semantic index settings', () => {
  it('does not enable vectors by default for local OpenAI-compatible chat providers', async () => {
    const settings = await resolveVsCodeSemanticIndexSettings(
      vsCodeMock({
        'provider.type': 'openai-compatible',
        'provider.baseUrl': 'http://localhost:11434/v1',
      }) as never,
      secrets as never,
    );

    expect(settings.enabled).toBe(false);
  });

  it('enables vectors for local providers when an embedding model is explicitly configured', async () => {
    const settings = await resolveVsCodeSemanticIndexSettings(
      vsCodeMock({
        'provider.type': 'openai-compatible',
        'provider.baseUrl': 'http://localhost:11434/v1',
        'semanticIndex.model': 'nomic-embed-text',
      }) as never,
      secrets as never,
    );

    expect(settings.enabled).toBe(true);
    expect(settings.model).toBe('nomic-embed-text');
  });
});
