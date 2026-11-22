import {
  AGENT_ENGINE_THRESHOLDS,
  agentEngineThresholdsOverridesSchema,
  resolveLoopPolicyThresholds,
  loopPolicyWindowBandDefinition,
} from '@mitii/sdk';
import type {
  AgentEngineThresholds,
  AgentEngineThresholdsOverrides,
  LoopPolicyWindowBand,
} from '@mitii/sdk';
import { projectNumberFields } from '@mitii/settings';
import type * as vscode from 'vscode';

import { LOOP_POLICY_PRESENTATION } from './loopPolicyFieldPresentation.js';
import type { TokenBudgetFieldDescriptor } from './protocol.js';

export type LoopPolicyFieldDescriptor = TokenBudgetFieldDescriptor;

export interface LoopPolicyBandSnapshot {
  id: LoopPolicyWindowBand;
  label: string;
  rangeLabel: string;
  contextWindowTokens: number;
}

function thresholdDefaults(
  thresholds: AgentEngineThresholds,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const key of Object.keys(LOOP_POLICY_PRESENTATION)) {
    const value = thresholds[key as keyof AgentEngineThresholds];
    if (typeof value === 'number') {
      out[key] = value;
    }
  }
  return out;
}

/**
 * Loop / stall fields: keys, bounds, and descriptions come from the
 * `@mitii/settings` catalog; presentation from `LOOP_POLICY_PRESENTATION`.
 * `defaultValue` is the SDK threshold baseline (`AGENT_ENGINE_THRESHOLDS`).
 */
function fieldsForThresholds(
  thresholds: AgentEngineThresholds,
): LoopPolicyFieldDescriptor[] {
  return projectNumberFields('loopPolicy', LOOP_POLICY_PRESENTATION, {
    tier: () => 'advanced',
    defaults: thresholdDefaults(thresholds),
  });
}

export const LOOP_POLICY_FIELDS: readonly LoopPolicyFieldDescriptor[] =
  fieldsForThresholds(AGENT_ENGINE_THRESHOLDS);

export function loopPolicyResetKeys(): readonly string[] {
  return [
    'loopPolicy.enabled',
    ...LOOP_POLICY_FIELDS.map((field) => `loopPolicy.${field.key}`),
  ];
}

export function readLoopPolicyEnabled(
  cfg: vscode.WorkspaceConfiguration,
): boolean {
  return cfg.get<boolean>('loopPolicy.enabled') === true;
}

/**
 * Host overrides passed into Engine only when Custom loop policy is enabled.
 */
export function readLoopPolicyThresholdOverrides(
  cfg: vscode.WorkspaceConfiguration,
): AgentEngineThresholdsOverrides | undefined {
  if (!readLoopPolicyEnabled(cfg)) {
    return undefined;
  }
  const overrides: Record<string, number> = {};
  for (const field of LOOP_POLICY_FIELDS) {
    const value = cfg.get<number>(`loopPolicy.${field.key}`);
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      continue;
    }
    const bounded = Math.max(
      field.min,
      Math.min(field.max ?? Number.POSITIVE_INFINITY, value),
    );
    overrides[field.key] =
      field.kind === 'int' ? Math.floor(bounded) : bounded;
  }
  if (Object.keys(overrides).length === 0) {
    return undefined;
  }
  return agentEngineThresholdsOverridesSchema.parse(overrides);
}

export interface LoopPolicySettingsSnapshot {
  enabled: boolean;
  /** Effective thresholds (band + optional lab overrides). */
  thresholds: Record<string, number>;
  /** Band-only thresholds (shipped standards for this window). */
  bandThresholds: Record<string, number>;
  band: LoopPolicyBandSnapshot;
  fields: LoopPolicyFieldDescriptor[];
}

export function readLoopPolicySettings(
  cfg: vscode.WorkspaceConfiguration,
  contextWindowTokens: number,
): LoopPolicySettingsSnapshot {
  const enabled = readLoopPolicyEnabled(cfg);
  const labOverrides = enabled
    ? readLoopPolicyThresholdOverrides(cfg)
    : undefined;
  const resolved = resolveLoopPolicyThresholds({
    contextWindowTokens,
    overrides: labOverrides,
  });
  const bandOnly = resolveLoopPolicyThresholds({ contextWindowTokens });
  const bandDef = loopPolicyWindowBandDefinition(resolved.band);

  return {
    enabled,
    thresholds: { ...resolved.thresholds },
    bandThresholds: { ...bandOnly.thresholds },
    band: {
      id: resolved.band,
      label: bandDef.label,
      rangeLabel: bandDef.rangeLabel,
      contextWindowTokens: resolved.contextWindowTokens,
    },
    fields: fieldsForThresholds(bandOnly.thresholds),
  };
}

export function defaultLoopPolicySettings(
  contextWindowTokens = 32_768,
): LoopPolicySettingsSnapshot {
  const resolved = resolveLoopPolicyThresholds({ contextWindowTokens });
  const bandDef = loopPolicyWindowBandDefinition(resolved.band);
  return {
    enabled: false,
    thresholds: { ...resolved.thresholds },
    bandThresholds: { ...resolved.thresholds },
    band: {
      id: resolved.band,
      label: bandDef.label,
      rangeLabel: bandDef.rangeLabel,
      contextWindowTokens: resolved.contextWindowTokens,
    },
    fields: fieldsForThresholds(resolved.thresholds),
  };
}
