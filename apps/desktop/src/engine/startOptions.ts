/**
 * Build MitiiStartInput extras from MITII_DESKTOP_SETTINGS_JSON.
 * Mirrors vscode hostAsk resolveRunBudget / tokenBudget / loopPolicy.
 */

import type { AgentRunBudget, MitiiStartInput } from '@mitii/sdk';

export function readDesktopSettingsJson(
  env: NodeJS.ProcessEnv = process.env,
): Record<string, unknown> | undefined {
  const json = env.MITII_DESKTOP_SETTINGS_JSON?.trim();
  if (!json) return undefined;
  try {
    const root = JSON.parse(json) as unknown;
    if (!root || typeof root !== 'object' || Array.isArray(root)) {
      return undefined;
    }
    return root as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function readPositiveNumber(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value;
  }
  return fallback;
}

function collectNumericOverrides(
  section: Record<string, unknown> | undefined,
): Record<string, number> | undefined {
  if (!section) return undefined;
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(section)) {
    if (key === 'enabled') continue;
    if (typeof value === 'number' && Number.isFinite(value)) {
      out[key] = value;
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function resolveRunBudget(
  settings: Record<string, unknown>,
): AgentRunBudget | undefined {
  const runBudget = asRecord(settings.runBudget);
  if (!runBudget) return undefined;

  if (runBudget.unlimited === true) {
    return {
      unlimited: true,
      maxModelCalls: 1_000_000,
      maxToolCalls: 1_000_000,
      maxLoopIterations: 1_000_000,
      maxWallTimeMs: 365 * 24 * 60 * 60 * 1000,
    };
  }

  return {
    maxModelCalls: Math.floor(
      readPositiveNumber(runBudget.maxModelCalls, 64),
    ),
    maxToolCalls: Math.floor(readPositiveNumber(runBudget.maxToolCalls, 128)),
    maxLoopIterations: Math.floor(
      readPositiveNumber(runBudget.maxLoopIterations, 96),
    ),
    maxWallTimeMs:
      Math.floor(readPositiveNumber(runBudget.maxWallTimeMinutes, 30)) *
      60 *
      1000,
  };
}

function resolveLogVerbosity(
  settings: Record<string, unknown>,
): MitiiStartInput['logVerbosity'] | undefined {
  const value = settings.logVerbosity;
  return value === 'minimal' || value === 'standard' || value === 'verbose'
    ? value
    : undefined;
}

/**
 * Extras merged into desktop buildStartInput from persisted settings JSON.
 */
export function buildDesktopStartExtras(
  env: NodeJS.ProcessEnv = process.env,
): Partial<MitiiStartInput> {
  const settings = readDesktopSettingsJson(env);
  if (!settings) return {};

  const extras: Partial<MitiiStartInput> = {};

  const budget = resolveRunBudget(settings);
  if (budget) extras.budget = budget;

  const tokenBudget = asRecord(settings.tokenBudget);
  const provider = asRecord(settings.provider);
  const windowBudget: NonNullable<MitiiStartInput['windowBudget']> = {};

  if (tokenBudget?.enabled === true) {
    const policy = collectNumericOverrides(tokenBudget);
    if (policy) windowBudget.policy = policy as never;
  }

  const maximumOutputTokens = provider?.maximumOutputTokens;
  if (
    typeof maximumOutputTokens === 'number' &&
    Number.isFinite(maximumOutputTokens) &&
    maximumOutputTokens > 0
  ) {
    windowBudget.maximumOutputTokens = Math.floor(maximumOutputTokens);
  }

  if (Object.keys(windowBudget).length > 0) {
    extras.windowBudget = windowBudget;
  }

  const loopPolicy = asRecord(settings.loopPolicy);
  if (loopPolicy?.enabled === true) {
    const thresholds = collectNumericOverrides(loopPolicy);
    if (thresholds) {
      extras.loopPolicy = { thresholds: thresholds as never };
    }
  }

  const logVerbosity = resolveLogVerbosity(settings);
  if (logVerbosity) extras.logVerbosity = logVerbosity;

  return extras;
}
