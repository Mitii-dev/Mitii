import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

import { isHostProviderType, type HostProviderType } from '@mitii/host';

import {
  parseLoopPolicyConfig,
  serializeLoopPolicyConfig,
  type MitiiLoopPolicyConfig,
} from './loopPolicy.js';

export type { MitiiLoopPolicyConfig };

export interface MitiiHostConfig {
  provider?: HostProviderType;
  /** Preset id: ollama | openai | openrouter | deepseek | azure-openai | anthropic | gemini | ... */
  providerPreset?: string;
  model?: string;
  baseUrl?: string;
  embeddingBackend?: 'auto' | 'bundled' | 'openai-compatible' | 'ollama' | 'disabled';
  embeddingSource?: 'bundled' | 'openai-compatible' | 'ollama' | 'disabled';
  embeddingModel?: string;
  embeddingDimensions?: number;
  /** Never read API keys from config files — env / SecretStorage only. */
  workspaceId?: string;
  defaultMode?: 'ask' | 'plan' | 'agent';
  /**
   * Optional lab loop/stall overrides (power users / benchmarks).
   * Leave unset or enabled:false for shipped window-band standards.
   */
  loopPolicy?: MitiiLoopPolicyConfig;
}

export function projectConfigPath(cwd: string = process.cwd()): string {
  return join(cwd, '.mitii', 'config.json');
}

export function globalConfigPath(): string {
  return join(homedir(), '.mitii', 'config.json');
}

function parseConfigObject(raw: Record<string, unknown>): MitiiHostConfig {
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
      typeof safe.provider === 'string' && isHostProviderType(safe.provider)
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
      safe.embeddingBackend === 'bundled' ||
      safe.embeddingBackend === 'openai-compatible' ||
      safe.embeddingBackend === 'ollama' ||
      safe.embeddingBackend === 'disabled'
        ? safe.embeddingBackend
        : undefined,
    embeddingSource:
      safe.embeddingSource === 'bundled' ||
      safe.embeddingSource === 'openai-compatible' ||
      safe.embeddingSource === 'ollama' ||
      safe.embeddingSource === 'disabled'
        ? safe.embeddingSource
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
    loopPolicy: parseLoopPolicyConfig(safe.loopPolicy),
  };
}

/**
 * Load optional host config from `.mitii/config.json` (cwd) or `~/.mitii/config.json`.
 * Secrets must come from environment variables, never from these files.
 */
export function loadMitiiHostConfig(cwd: string = process.cwd()): MitiiHostConfig {
  const candidates = [projectConfigPath(cwd), globalConfigPath()];
  for (const path of candidates) {
    if (!existsSync(path)) continue;
    try {
      const raw = JSON.parse(readFileSync(path, 'utf8')) as Record<
        string,
        unknown
      >;
      return parseConfigObject(raw);
    } catch {
      continue;
    }
  }
  return {};
}

/**
 * Persist non-secret host config. Never writes API keys.
 */
export function saveMitiiHostConfig(
  config: MitiiHostConfig,
  options: { cwd?: string; global?: boolean } = {},
): string {
  const path = options.global
    ? globalConfigPath()
    : projectConfigPath(options.cwd ?? process.cwd());
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true });

  const existing = existsSync(path)
    ? (() => {
        try {
          return parseConfigObject(
            JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>,
          );
        } catch {
          return {} as MitiiHostConfig;
        }
      })()
    : {};

  const merged: MitiiHostConfig = { ...existing, ...config };
  if (config.loopPolicy === undefined && existing.loopPolicy) {
    merged.loopPolicy = existing.loopPolicy;
  }
  const payload: Record<string, unknown> = {};
  if (merged.provider) payload.provider = merged.provider;
  if (merged.providerPreset) payload.providerPreset = merged.providerPreset;
  if (merged.model) payload.model = merged.model;
  if (merged.baseUrl) payload.baseUrl = merged.baseUrl;
  if (merged.embeddingBackend) payload.embeddingBackend = merged.embeddingBackend;
  if (merged.embeddingSource) payload.embeddingSource = merged.embeddingSource;
  if (merged.embeddingModel) payload.embeddingModel = merged.embeddingModel;
  if (merged.embeddingDimensions !== undefined) {
    payload.embeddingDimensions = merged.embeddingDimensions;
  }
  if (merged.workspaceId) payload.workspaceId = merged.workspaceId;
  if (merged.defaultMode) payload.defaultMode = merged.defaultMode;
  const loopPolicyPayload = serializeLoopPolicyConfig(merged.loopPolicy);
  if (loopPolicyPayload) payload.loopPolicy = loopPolicyPayload;

  writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return path;
}
