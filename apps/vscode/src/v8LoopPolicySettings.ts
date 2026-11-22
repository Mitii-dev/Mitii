import {
  V8_ENGINE_THRESHOLDS,
  resolveV8LoopPolicyThresholds,
  v8EngineBandDefinition,
  type V8EngineThresholds,
  type V8EngineThresholdsOverrides,
} from '@mitii/sdk';
import { projectNumberFields } from '@mitii/settings';
import type * as vscode from 'vscode';

import type { TokenBudgetFieldDescriptor } from './protocol.js';
import { V8_LOOP_POLICY_PRESENTATION } from './v8LoopPolicyFieldPresentation.js';

export type V8LoopPolicyFieldDescriptor = TokenBudgetFieldDescriptor;

function thresholdDefaults(
  thresholds: V8EngineThresholds,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const key of Object.keys(V8_LOOP_POLICY_PRESENTATION)) {
    const value = thresholds[key as keyof V8EngineThresholds];
    if (typeof value === 'number') {
      out[key] = value;
    }
  }
  return out;
}

/**
 * V8 engine fields: keys, bounds, and descriptions come from the
 * `@mitii/settings` catalog; presentation from `V8_LOOP_POLICY_PRESENTATION`.
 * `defaultValue` is the SDK threshold baseline (`V8_ENGINE_THRESHOLDS`).
 */
function fieldsForThresholds(
  thresholds: V8EngineThresholds,
): V8LoopPolicyFieldDescriptor[] {
  return projectNumberFields('v8LoopPolicy', V8_LOOP_POLICY_PRESENTATION, {
    tier: () => 'advanced',
    defaults: thresholdDefaults(thresholds),
  });
}

export const V8_LOOP_POLICY_FIELDS: readonly V8LoopPolicyFieldDescriptor[] =
  fieldsForThresholds(V8_ENGINE_THRESHOLDS);

export function v8LoopPolicyResetKeys(): readonly string[] {
  return [
    'v8LoopPolicy.enabled',
    ...V8_LOOP_POLICY_FIELDS.map((field) => `v8LoopPolicy.${field.key}`),
  ];
}

export function readV8LoopPolicyEnabled(
  cfg: vscode.WorkspaceConfiguration,
): boolean {
  return cfg.get<boolean>('v8LoopPolicy.enabled') === true;
}

export function readV8LoopPolicyThresholdOverrides(
  cfg: vscode.WorkspaceConfiguration,
): V8EngineThresholdsOverrides | undefined {
  if (!readV8LoopPolicyEnabled(cfg)) {
    return undefined;
  }
  const overrides: Record<string, number> = {};
  for (const field of V8_LOOP_POLICY_FIELDS) {
    const value = cfg.get<number>(`v8LoopPolicy.${field.key}`);
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
  return Object.keys(overrides).length > 0
    ? (overrides as V8EngineThresholdsOverrides)
    : undefined;
}

export interface V8LoopPolicySettingsSnapshot {
  enabled: boolean;
  thresholds: Record<string, number>;
  bandThresholds: Record<string, number>;
  band: {
    id: 'compact' | 'standard' | 'wide';
    label: string;
    rangeLabel: string;
    contextWindowTokens: number;
  };
  fields: V8LoopPolicyFieldDescriptor[];
}

export function readV8LoopPolicySettings(
  cfg: vscode.WorkspaceConfiguration,
  contextWindowTokens: number,
): V8LoopPolicySettingsSnapshot {
  const enabled = readV8LoopPolicyEnabled(cfg);
  const labOverrides = enabled
    ? readV8LoopPolicyThresholdOverrides(cfg)
    : undefined;
  const resolved = resolveV8LoopPolicyThresholds({
    contextWindowTokens,
    overrides: labOverrides,
  });
  const bandOnly = resolveV8LoopPolicyThresholds({ contextWindowTokens });
  const bandDef = v8EngineBandDefinition(resolved.band);

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
