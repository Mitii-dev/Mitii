/**
 * Host-facing context-window helpers.
 * Pure resolution lives in `@mitii/ui-core` (renderer-safe); this module adds
 * env/config resolution for CLI / automation / headless hosts.
 */

export {
  DEFAULT_CONTEXT_WINDOW,
  clampMaximumOutputTokensToContext,
  inferContextWindowFromModelId,
  inferMaximumOutputTokensFromModelId,
  parseContextWindowTokens,
  resolveEffectiveContextWindow,
} from '@mitii/ui-core';

import {
  parseContextWindowTokens,
  resolveEffectiveContextWindow,
} from '@mitii/ui-core';

/**
 * Resolve context window for headless hosts (CLI / automation / benchmark)
 * from env + optional config fields + model/provider inference.
 */
export function resolveHostContextWindowTokens(params: {
  env?: NodeJS.ProcessEnv;
  model: string;
  providerType?: string;
  /** Explicit config value (`.mitii/config.json` contextWindowTokens, etc.). */
  configContextWindowTokens?: unknown;
}): number {
  const env = params.env ?? process.env;
  const fromEnv = parseContextWindowTokens(
    env.MITII_CONTEXT_WINDOW ?? env.MITII_CONTEXT_WINDOW_TOKENS,
  );
  const fromConfig = parseContextWindowTokens(params.configContextWindowTokens);
  const stored = fromEnv > 0 ? fromEnv : fromConfig;
  return resolveEffectiveContextWindow(
    stored,
    params.model,
    params.providerType,
  );
}
