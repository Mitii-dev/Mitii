import type { NumberFieldPresentationMap } from '@mitii/settings';

/**
 * Loop / stall presentation overlay. Keys, bounds, and descriptions come from
 * the `@mitii/settings` catalog (`mitii.loopPolicy.*`); this file only owns
 * grouping, labels, input kind/step, and tier. Entry order sets the order
 * fields appear in the editor.
 */

const G_EXPLORATION = 'Exploration stall';
const G_READ_MUTATE = 'Read / mutate pressure';
const G_RECOVERIES = 'Recoveries';
const G_VERIFICATION_REPAIR = 'Verification repair';
const G_BATCH_FALLBACKS = 'Mutation batch fallbacks';
const G_TRANSCRIPT = 'Transcript';

export const LOOP_POLICY_PRESENTATION: NumberFieldPresentationMap = {
  explorationRereadMinCalls: { group: G_EXPLORATION, label: 'Min re-read calls', kind: 'int', step: 1, tier: 'simple' },
  explorationRereadRatio: { group: G_EXPLORATION, label: 'Re-read ratio', kind: 'number', step: 0.25, tier: 'simple' },
  maxExplorationStallNudges: { group: G_EXPLORATION, label: 'Stall nudges before stop', kind: 'int', step: 1, tier: 'simple' },
  maxReadOnlyToolTurnsBeforeMutationNudge: { group: G_READ_MUTATE, label: 'Read turns before mutation nudge', kind: 'int', step: 1, tier: 'simple' },
  maxReadOnlyMutationRetryAttempts: { group: G_READ_MUTATE, label: 'Post-nudge read retries', kind: 'int', step: 1, tier: 'simple' },
  maxReadOnlyToolTurnsAfterMutationNudge: { group: G_READ_MUTATE, label: 'Post-mutation read turns', kind: 'int', step: 1, tier: 'simple' },
  maxReadOnlyToolTurnsAfterMutationNudges: { group: G_READ_MUTATE, label: 'Post-mutation read nudges', kind: 'int', step: 1, tier: 'advanced' },
  maxTruncationRecoveries: { group: G_RECOVERIES, label: 'Truncation recoveries', kind: 'int', step: 1, tier: 'advanced' },
  maxIncompleteAnswerRecoveries: { group: G_RECOVERIES, label: 'Incomplete-answer recoveries', kind: 'int', step: 1, tier: 'advanced' },
  maxUnfulfilledExecuteRecoveries: { group: G_RECOVERIES, label: 'Unfulfilled-execute recoveries', kind: 'int', step: 1, tier: 'advanced' },
  maxStructuredReviewRecoveries: { group: G_RECOVERIES, label: 'Structured-review recoveries', kind: 'int', step: 1, tier: 'advanced' },
  maxRejectedMutationRecoveries: { group: G_RECOVERIES, label: 'Rejected-mutation recoveries', kind: 'int', step: 1, tier: 'advanced' },
  maxMustReadNudges: { group: G_RECOVERIES, label: 'Must-read nudges', kind: 'int', step: 1, tier: 'advanced' },
  verificationRepairModelCallReserveRatio: { group: G_VERIFICATION_REPAIR, label: 'Repair model-call reserve', kind: 'ratio', step: 0.05, tier: 'advanced' },
  maxVerificationRepairAttempts: { group: G_VERIFICATION_REPAIR, label: 'Max verification repairs', kind: 'int', step: 1, tier: 'advanced' },
  maxStalledVerificationRepairs: { group: G_VERIFICATION_REPAIR, label: 'Stalled repair stop', kind: 'int', step: 1, tier: 'advanced' },
  defaultPreferredBatchSize: { group: G_BATCH_FALLBACKS, label: 'Preferred batch size', kind: 'int', step: 1, tier: 'advanced' },
  defaultMaxPatchesPerCall: { group: G_BATCH_FALLBACKS, label: 'Max patches per call', kind: 'int', step: 1, tier: 'advanced' },
  maxRecoveredAnalysisChars: { group: G_TRANSCRIPT, label: 'Recovered analysis chars', kind: 'int', step: 16, tier: 'advanced' },
  maxReasoningCharsWithoutProgress: { group: G_TRANSCRIPT, label: 'Reasoning progress budget', kind: 'int', step: 500, tier: 'advanced' },
};
