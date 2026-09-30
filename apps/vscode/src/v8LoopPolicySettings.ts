import {
  V8_ENGINE_THRESHOLDS,
  resolveV8LoopPolicyThresholds,
  v8EngineBandDefinition,
  type V8EngineThresholds,
  type V8EngineThresholdsOverrides,
} from '@mitii/sdk';
import type * as vscode from 'vscode';

import type { TokenBudgetFieldDescriptor } from './protocol.js';

export type V8LoopPolicyFieldDescriptor = TokenBudgetFieldDescriptor;

const V8_LOOP_POLICY_FIELD_SPECS: readonly Omit<
  V8LoopPolicyFieldDescriptor,
  'defaultValue'
>[] = [
  {
    key: 'maxReadOnlyTurnsBeforeMutationNudge',
    group: 'V8 mutation pressure',
    label: 'Read turns before mutation nudge',
    description:
      'Soft nudge after this many readonly tool turns with zero mutations (v8-engine).',
    kind: 'int',
    min: 1,
    max: 32,
    step: 1,
    tier: 'simple',
  },
  {
    key: 'toolLoopSoftIdentical',
    group: 'V8 tool loop',
    label: 'Identical-tool soft nudge',
    description: 'Identical name+args batches before a soft change-approach notice.',
    kind: 'int',
    min: 1,
    max: 12,
    step: 1,
    tier: 'simple',
  },
  {
    key: 'toolLoopHardIdentical',
    group: 'V8 tool loop',
    label: 'Identical-tool force-final',
    description: 'Identical batches before forcing a final answer.',
    kind: 'int',
    min: 2,
    max: 20,
    step: 1,
    tier: 'simple',
  },
  {
    key: 'maxTruncationRecoveries',
    group: 'V8 recoveries',
    label: 'Truncation recoveries',
    description:
      'Provider length recoveries; resets when any tool call appears.',
    kind: 'int',
    min: 0,
    max: 8,
    step: 1,
    tier: 'simple',
  },
  {
    key: 'maxReasoningCharsWithoutProgress',
    group: 'V8 recoveries',
    label: 'Reasoning progress budget',
    description:
      'Honest abort when reasoning alone exceeds this with no content or tools.',
    kind: 'int',
    min: 1000,
    max: 100_000,
    step: 500,
    tier: 'advanced',
  },
  {
    key: 'maxUnfulfilledExecuteRecoveries',
    group: 'V8 recoveries',
    label: 'Unfulfilled-execute recoveries',
    description: 'Text-only turns toward apply_patch when mutation is required.',
    kind: 'int',
    min: 0,
    max: 8,
    step: 1,
    tier: 'advanced',
  },
  {
    key: 'maxContinueOverrides',
    group: 'V8 recoveries',
    label: 'Continue overrides',
    description: 'User Continue overrides after stall / loop_detected walls.',
    kind: 'int',
    min: 0,
    max: 12,
    step: 1,
    tier: 'advanced',
  },
  {
    key: 'preferredBatchSize',
    group: 'V8 mutation batch',
    label: 'Preferred patch batch size',
    description: 'Preferred apply_patch batch sizing hint.',
    kind: 'int',
    min: 1,
    max: 32,
    step: 1,
    tier: 'advanced',
  },
];

export const V8_LOOP_POLICY_FIELDS: readonly V8LoopPolicyFieldDescriptor[] =
  V8_LOOP_POLICY_FIELD_SPECS.map((field) => ({
    ...field,
    defaultValue:
      V8_ENGINE_THRESHOLDS[field.key as keyof V8EngineThresholds],
  }));

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
    id: string;
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
    fields: V8_LOOP_POLICY_FIELD_SPECS.map((field) => ({
      ...field,
      defaultValue:
        bandOnly.thresholds[field.key as keyof V8EngineThresholds],
    })),
  };
}
