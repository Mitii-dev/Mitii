import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface MitiiHostConfig {
  provider?: 'echo' | 'openai-compatible';
  /** Preset id: ollama | openai | openrouter | deepseek | azure-openai | lm-studio | openai-compatible */
  providerPreset?: string;
  model?: string;
  baseUrl?: string;
  embeddingBackend?: 'auto' | 'openai-compatible' | 'ollama' | 'disabled';
  embeddingModel?: string;
  embeddingDimensions?: number;
  /** Never read API keys from config files — env / SecretStorage only. */
  workspaceId?: string;
  defaultMode?: 'ask' | 'plan' | 'agent';
}

/**
 * Load optional host config from `.mitii/config.json` (cwd) or `~/.mitii/config.json`.
 * Secrets must come from environment variables, never from these files.
 */
export function loadMitiiHostConfig(cwd: string = process.cwd()): MitiiHostConfig {
  const candidates = [
    join(cwd, '.mitii', 'config.json'),
    join(homedir(), '.mitii', 'config.json'),
  ];
  for (const path of candidates) {
    if (!existsSync(path)) continue;
    try {
      const raw = JSON.parse(readFileSync(path, 'utf8')) as Record<
        string,
        unknown
      >;
      // Strip any accidental secret fields.
      const {
        apiKey: _a,
        api_key: _b,
        token: _c,
        secret: _d,
        ...safe
      } = raw;
      return {
        provider:
          safe.provider === 'echo' || safe.provider === 'openai-compatible'
            ? safe.provider
            : undefined,
        providerPreset:
          typeof safe.providerPreset === 'string'
            ? safe.providerPreset
            : undefined,
        model: typeof safe.model === 'string' ? safe.model : undefined,
        baseUrl: typeof safe.baseUrl === 'string' ? safe.baseUrl : undefined,
        embeddingBackend:
          safe.embeddingBackend === 'auto' ||
          safe.embeddingBackend === 'openai-compatible' ||
          safe.embeddingBackend === 'ollama' ||
          safe.embeddingBackend === 'disabled'
            ? safe.embeddingBackend
            : undefined,
        embeddingModel:
          typeof safe.embeddingModel === 'string'
            ? safe.embeddingModel
            : undefined,
        embeddingDimensions:
          typeof safe.embeddingDimensions === 'number' &&
          Number.isFinite(safe.embeddingDimensions) &&
          safe.embeddingDimensions > 0
            ? Math.floor(safe.embeddingDimensions)
            : undefined,
        workspaceId:
          typeof safe.workspaceId === 'string' ? safe.workspaceId : undefined,
        defaultMode:
          safe.defaultMode === 'ask' ||
          safe.defaultMode === 'plan' ||
          safe.defaultMode === 'agent'
            ? safe.defaultMode
            : undefined,
      };
    } catch {
      continue;
    }
  }
  return {};
}
