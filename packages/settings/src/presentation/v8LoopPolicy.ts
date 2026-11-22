import type { NumberFieldPresentationMap } from '../contracts/numberFieldDescriptor.js';

/**
 * V8 engine knob presentation overlay. Keys, bounds, and descriptions come
 * from the `@mitii/settings` catalog (`mitii.v8LoopPolicy.*`); this file only
 * owns grouping, labels, input kind/step, and tier. Entry order sets the
 * order fields appear in the editor.
 */

const G_MUTATION_PRESSURE = 'V8 mutation pressure';
const G_TOOL_LOOP = 'V8 tool loop';
const G_RECOVERIES = 'V8 recoveries';
const G_MUTATION_BATCH = 'V8 mutation batch';

export const V8_LOOP_POLICY_PRESENTATION: NumberFieldPresentationMap = {
  maxReadOnlyTurnsBeforeMutationNudge: { group: G_MUTATION_PRESSURE, label: 'Read turns before mutation nudge', kind: 'int', step: 1, tier: 'simple' },
  toolLoopSoftIdentical: { group: G_TOOL_LOOP, label: 'Identical-tool soft nudge', kind: 'int', step: 1, tier: 'simple' },
  toolLoopHardIdentical: { group: G_TOOL_LOOP, label: 'Identical-tool force-final', kind: 'int', step: 1, tier: 'simple' },
  maxTruncationRecoveries: { group: G_RECOVERIES, label: 'Truncation recoveries', kind: 'int', step: 1, tier: 'simple' },
  maxReasoningCharsWithoutProgress: { group: G_RECOVERIES, label: 'Reasoning progress budget', kind: 'int', step: 500, tier: 'advanced' },
  maxUnfulfilledExecuteRecoveries: { group: G_RECOVERIES, label: 'Unfulfilled-execute recoveries', kind: 'int', step: 1, tier: 'advanced' },
  maxContinueOverrides: { group: G_RECOVERIES, label: 'Continue overrides', kind: 'int', step: 1, tier: 'advanced' },
  preferredBatchSize: { group: G_MUTATION_BATCH, label: 'Preferred patch batch size', kind: 'int', step: 1, tier: 'advanced' },
};
