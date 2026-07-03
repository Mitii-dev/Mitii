import { existsSync } from 'fs';
import { join } from 'path';
import type { ProviderType, ThunderConfig } from '../config/schema';
import { defaultThunderConfig } from '../config/defaults';
import { resolveEffectiveSafety } from '../safety/autonomyPresets';

export type HeadlessRuntime = 'real' | 'stub';

export interface HeadlessAgentOptions {
  cwd: string;
  packageRoot?: string;
  runtime?: HeadlessRuntime;
  providerType?: ProviderType;
  baseUrl?: string;
  model?: string;
  apiKey?: string;
  approval?: 'auto' | 'manual';
  allowNetwork?: boolean;
  enablePuppeteer?: boolean;
  indexWorkspace?: boolean;
  configOverrides?: Partial<ThunderConfig>;
}

export function resolveMitiiPackageRoot(fromDir: string): string {
  let current = fromDir;
  for (let depth = 0; depth < 4; depth += 1) {
    if (existsSync(join(current, 'package.json'))) return current;
    const parent = join(current, '..');
    if (parent === current) break;
    current = parent;
  }
  return fromDir;
}

export function buildHeadlessConfig(options: HeadlessAgentOptions): ThunderConfig {
  const base = defaultThunderConfig();
  const approvalMode = options.approval === 'auto' ? 'auto' as const : 'review_all' as const;
  const safety = resolveEffectiveSafety({
    ...base.safety,
    approvalMode,
    allowUntrustedWorkspace: true,
    allowNetwork: options.allowNetwork ?? false,
  });

  const mcp = {
    ...base.mcp,
    enabled: true,
    preloadBuiltin: true,
    builtinServers: {
      ...base.mcp.builtinServers,
      puppeteer: options.enablePuppeteer ?? false,
    },
  };

  const config: ThunderConfig = {
    ...base,
    ...options.configOverrides,
    provider: {
      ...base.provider,
      type: options.providerType ?? base.provider.type,
      baseUrl: options.baseUrl ?? base.provider.baseUrl,
      model: options.model ?? base.provider.model,
      supportsTools: options.runtime === 'stub' ? false : true,
    },
    safety,
    mcp,
    indexing: {
      ...base.indexing,
      vectorsEnabled: false,
      autoIndexOnOpen: options.indexWorkspace !== false,
      ...(options.configOverrides?.indexing ?? {}),
    },
    agent: {
      ...base.agent,
      verifyOnActComplete: true,
      ...(options.configOverrides?.agent ?? {}),
    },
    telemetry: {
      ...base.telemetry,
      sessionLogging: true,
      debugMetrics: true,
      ...(options.configOverrides?.telemetry ?? {}),
    },
  };

  return config;
}

export function resolveApiKey(providerType: ProviderType): string | undefined {
  if (providerType === 'anthropic') return process.env.ANTHROPIC_API_KEY ?? process.env.MITII_API_KEY;
  if (providerType === 'gemini') return process.env.GEMINI_API_KEY ?? process.env.MITII_API_KEY;
  if (providerType === 'openrouter') return process.env.OPENROUTER_API_KEY ?? process.env.MITII_API_KEY;
  return process.env.MITII_API_KEY ?? process.env.OPENAI_API_KEY;
}
