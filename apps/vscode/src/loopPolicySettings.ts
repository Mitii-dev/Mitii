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
import type * as vscode from 'vscode';

import type { TokenBudgetFieldDescriptor } from './protocol.js';

export type LoopPolicyFieldDescriptor = TokenBudgetFieldDescriptor;

export interface LoopPolicyBandSnapshot {
  id: LoopPolicyWindowBand;
  label: string;
  rangeLabel: string;
  contextWindowTokens: number;
}

const LOOP_POLICY_FIELD_SPECS: readonly Omit<
  LoopPolicyFieldDescriptor,
  'defaultValue'
>[] = [
  {
    key: 'explorationRereadMinCalls',
    group: 'Exploration stall',
    label: 'Min re-read calls',
    description:
      'Stall check starts after this many file-read calls in the current loop.',
    kind: 'int',
    min: 1,
    max: 64,
    step: 1,
    tier: 'simple',
  },
  {
    key: 'explorationRereadRatio',
    group: 'Exploration stall',
    label: 'Re-read ratio',
    description:
      'Trip when file-read calls ≥ unique paths × this ratio (2 = twice as many reads as paths).',
    kind: 'number',
    min: 1,
    max: 10,
    step: 0.25,
    tier: 'simple',
  },
  {
    key: 'maxExplorationStallNudges',
    group: 'Exploration stall',
    label: 'Stall nudges before stop',
    description:
      'Mid-loop nudges before exploration_stall_broken. 0 stops on the first heavy re-read signal.',
    kind: 'int',
    min: 0,
    max: 8,
    step: 1,
    tier: 'simple',
  },
  {
    key: 'maxReadOnlyToolTurnsBeforeMutationNudge',
    group: 'Read / mutate pressure',
    label: 'Read turns before mutation nudge',
    description:
      'Successful read/search turns allowed in execute mode before requiring apply_patch.',
    kind: 'int',
    min: 1,
    max: 32,
    step: 1,
    tier: 'simple',
  },
  {
    key: 'maxReadOnlyMutationRetryAttempts',
    group: 'Read / mutate pressure',
    label: 'Post-nudge read retries',
    description:
      'Extra read-only turns after the first-mutation nudge before failing the run.',
    kind: 'int',
    min: 0,
    max: 8,
    step: 1,
    tier: 'simple',
  },
  {
    key: 'maxReadOnlyToolTurnsAfterMutationNudge',
    group: 'Read / mutate pressure',
    label: 'Post-mutation read turns',
    description:
      'Consecutive non-mutating tool turns allowed after the first successful mutation.',
    kind: 'int',
    min: 1,
    max: 16,
    step: 1,
    tier: 'simple',
  },
  {
    key: 'maxReadOnlyToolTurnsAfterMutationNudges',
    group: 'Read / mutate pressure',
    label: 'Post-mutation read nudges',
    description:
      'How many times to nudge after post-mutation read spinning before stopping the first loop.',
    kind: 'int',
    min: 0,
    max: 4,
    step: 1,
    tier: 'advanced',
  },
  {
    key: 'maxTruncationRecoveries',
    group: 'Recoveries',
    label: 'Truncation recoveries',
    description: 'Retries after finishReason=length with incomplete tools.',
    kind: 'int',
    min: 0,
    max: 8,
    step: 1,
    tier: 'advanced',
  },
  {
    key: 'maxIncompleteAnswerRecoveries',
    group: 'Recoveries',
    label: 'Incomplete-answer recoveries',
    description: 'Nudges for empty or transitional narration with no tools.',
    kind: 'int',
    min: 0,
    max: 8,
    step: 1,
    tier: 'advanced',
  },
  {
    key: 'maxUnfulfilledExecuteRecoveries',
    group: 'Recoveries',
    label: 'Unfulfilled-execute recoveries',
    description:
      'Nudges when execute+write ends on diagnosis text instead of apply_patch.',
    kind: 'int',
    min: 0,
    max: 8,
    step: 1,
    tier: 'advanced',
  },
  {
    key: 'maxRejectedMutationRecoveries',
    group: 'Recoveries',
    label: 'Rejected-mutation recoveries',
    description:
      'Retries after apply_patch/delete_file/move_file is rejected (stale oldText, missing path, bad args). Separate from text-only unfulfilled-execute nudges.',
    kind: 'int',
    min: 0,
    max: 8,
    step: 1,
    tier: 'advanced',
  },
  {
    key: 'maxMustReadNudges',
    group: 'Recoveries',
    label: 'Must-read nudges',
    description:
      'Times to withhold a mutation when active-task mustRead paths are not loaded.',
    kind: 'int',
    min: 0,
    max: 4,
    step: 1,
    tier: 'advanced',
  },
  {
    key: 'verificationRepairModelCallReserveRatio',
    group: 'Verification repair',
    label: 'Repair model-call reserve',
    description:
      'Fraction of maxModelCalls held back from the first mutate loop for remaining-error repairs.',
    kind: 'ratio',
    min: 0,
    max: 1,
    step: 0.05,
    tier: 'advanced',
  },
  {
    key: 'maxVerificationRepairAttempts',
    group: 'Verification repair',
    label: 'Max verification repairs',
    description:
      'Fallback remaining-error repair cap when Window Policy is absent.',
    kind: 'int',
    min: 0,
    max: 24,
    step: 1,
    tier: 'advanced',
  },
  {
    key: 'maxStalledVerificationRepairs',
    group: 'Verification repair',
    label: 'Stalled repair stop',
    description:
      'Stop repairing after this many consecutive non-improving verifies.',
    kind: 'int',
    min: 1,
    max: 8,
    step: 1,
    tier: 'advanced',
  },
  {
    key: 'defaultPreferredBatchSize',
    group: 'Mutation batch fallbacks',
    label: 'Preferred batch size',
    description: 'Fallback preferred batch size when the grant omits mutationBudget.',
    kind: 'int',
    min: 1,
    max: 32,
    step: 1,
    tier: 'advanced',
  },
  {
    key: 'defaultMaxPatchesPerCall',
    group: 'Mutation batch fallbacks',
    label: 'Max patches per call',
    description: 'Fallback hard patch cap when the grant omits mutationBudget.',
    kind: 'int',
    min: 1,
    max: 64,
    step: 1,
    tier: 'advanced',
  },
  {
    key: 'maxRecoveredAnalysisChars',
    group: 'Transcript',
    label: 'Recovered analysis chars',
    description:
      'Keep at most this many characters of mid-work analysis dumps in the transcript.',
    kind: 'int',
    min: 64,
    max: 4000,
    step: 16,
    tier: 'advanced',
  },
];

export const LOOP_POLICY_FIELDS: readonly LoopPolicyFieldDescriptor[] =
  LOOP_POLICY_FIELD_SPECS.map((field) => ({
    ...field,
    defaultValue:
      AGENT_ENGINE_THRESHOLDS[field.key as keyof AgentEngineThresholds],
  }));

function fieldsForThresholds(
  thresholds: AgentEngineThresholds,
): LoopPolicyFieldDescriptor[] {
  return LOOP_POLICY_FIELD_SPECS.map((field) => ({
    ...field,
    defaultValue: thresholds[field.key as keyof AgentEngineThresholds],
  }));
}

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
