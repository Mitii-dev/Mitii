/**
 * Renderer-safe ship baselines for `mitii.loopPolicy.*` and
 * `mitii.v8LoopPolicy.*` number fields. Keep aligned with
 * `AGENT_ENGINE_THRESHOLDS` and `V8_ENGINE_THRESHOLDS` in `@mitii/v8`; the
 * VS Code `*FieldsFromCatalog` tests pin that equality because this package
 * cannot import the SDK.
 */

export const DEFAULT_LOOP_POLICY_NUMBERS: Readonly<Record<string, number>> = {
  explorationRereadMinCalls: 6,
  explorationRereadRatio: 2,
  maxExplorationStallNudges: 1,
  maxReadOnlyToolTurnsBeforeMutationNudge: 4,
  maxReadOnlyMutationRetryAttempts: 2,
  maxReadOnlyToolTurnsAfterMutationNudge: 3,
  maxReadOnlyToolTurnsAfterMutationNudges: 1,
  maxTruncationRecoveries: 3,
  maxIncompleteAnswerRecoveries: 2,
  maxUnfulfilledExecuteRecoveries: 2,
  maxStructuredReviewRecoveries: 2,
  maxRejectedMutationRecoveries: 3,
  maxMustReadNudges: 1,
  verificationRepairModelCallReserveRatio: 0.2,
  maxVerificationRepairAttempts: 8,
  maxStalledVerificationRepairs: 2,
  defaultPreferredBatchSize: 12,
  defaultMaxPatchesPerCall: 24,
  maxRecoveredAnalysisChars: 480,
  maxReasoningCharsWithoutProgress: 28_000,
};

export const DEFAULT_V8_LOOP_POLICY_NUMBERS: Readonly<Record<string, number>> =
  {
    maxReadOnlyTurnsBeforeMutationNudge: 12,
    toolLoopSoftIdentical: 3,
    toolLoopHardIdentical: 6,
    maxTruncationRecoveries: 3,
    maxReasoningCharsWithoutProgress: 28_000,
    maxUnfulfilledExecuteRecoveries: 2,
    maxContinueOverrides: 4,
    preferredBatchSize: 12,
  };
