import type { ModelToolDefinition } from "../../modules/model-gateway";
import {
  listBuiltinMutationModelToolDefinitions,
  listBuiltinReadOnlyModelToolDefinitions,
} from "../tool-runtime";

/**
 * Tunable Agent Engine thresholds for token / truncation recovery.
 */
export const AGENT_ENGINE_THRESHOLDS = {
  /** Max automatic recoveries after finishReason=length with incomplete tools. */
  maxTruncationRecoveries: 3,
  /**
   * Max nudges when the model returns empty content or transitional narration
   * ("Let me check…") with no tool calls instead of a final answer.
   */
  maxIncompleteAnswerRecoveries: 2,
  /**
   * Max nudges when execute+write+mutation intent ends on a text-only
   * diagnosis instead of apply_patch.
   */
  maxUnfulfilledExecuteRecoveries: 1,
  /**
   * Extra grace turns after the first-mutation nudge when the model keeps
   * reading files instead of patching. Kept separate from text-only
   * unfulfilled execute so essays / rejected-tool loops do not get looser.
   */
  maxReadOnlyMutationRetryAttempts: 2,
  /**
   * Max successful read/search/tool turns in execute mode before requiring the
   * first mutation attempt. This catches broad investigation loops that never
   * reach apply_patch.
   */
  maxReadOnlyToolTurnsBeforeMutationNudge: 6,
  /**
   * After the first mutation, cap consecutive non-mutating tool turns so
   * glob/search cannot spin while the transcript is expensive.
   */
  maxReadOnlyToolTurnsAfterMutationNudge: 3,
  /**
   * One post-mutation read nudge, then stop the first loop so verification
   * repair can use remaining model-call budget instead of another glob pass.
   */
  maxReadOnlyToolTurnsAfterMutationNudges: 1,
  /**
   * Share of maxModelCalls held back from the first mutate loop so
   * remaining-error repairs can start. Floor of 1 when repairs are enabled.
   */
  verificationRepairModelCallReserveRatio: 0.2,
  /** Fallback preferred batch size when grant omits mutationBudget. */
  defaultPreferredBatchSize: 8,
  /** Fallback hard patch cap when grant omits mutationBudget. */
  defaultMaxPatchesPerCall: 16,
  /**
   * Flag context-loss re-reads when file-read calls exceed unique paths
   * by this ratio and at least `explorationRereadMinCalls` reads occurred.
   */
  explorationRereadRatio: 2,
  explorationRereadMinCalls: 8,
  /** One mid-loop nudge, then stop the spin. */
  maxExplorationStallNudges: 1,
  /**
   * Fallback remaining-error repairs when Window Policy is absent.
   * Window effort is the live cap (medium: 8). Stop earlier when
   * consecutive verifies stop improving.
   */
  maxVerificationRepairAttempts: 8,
  /** Stop repairing after this many consecutive non-improving verifies. */
  maxStalledVerificationRepairs: 2,
  /**
   * When a recovered turn was a mid-work analysis dump, keep only this many
   * characters in the transcript so leftover output budget remains for patches.
   */
  maxRecoveredAnalysisChars: 480,
} as const;

/**
 * Routes supported by the single-agent Engine after Phase 8.
 * Phase 9 optionally attaches Skills/Memory before prompt construction.
 */
export const PHASE8_SUPPORTED_ROUTES = [
  "direct_answer",
  "repository_answer",
  "clarify",
  "diagnose",
  "plan",
  "execute",
] as const;

/** @deprecated Use PHASE8_SUPPORTED_ROUTES. Kept for existing Phase 7 tests. */
export const PHASE7_SUPPORTED_ROUTES = [
  "direct_answer",
  "repository_answer",
  "clarify",
  "diagnose",
] as const;

/**
 * Default JSON tool schemas for grant-filtered prompt attachment.
 * Generated from Tool Runtime registered definitions (single source of truth).
 * Tool Runtime still validates with Zod schemas at execute time.
 */
export const DEFAULT_READ_ONLY_TOOL_DEFINITIONS: readonly ModelToolDefinition[] =
  listBuiltinReadOnlyModelToolDefinitions();

export const DEFAULT_MUTATION_TOOL_DEFINITIONS: readonly ModelToolDefinition[] =
  listBuiltinMutationModelToolDefinitions();

export const DEFAULT_TOOL_DEFINITIONS: readonly ModelToolDefinition[] = [
  ...DEFAULT_READ_ONLY_TOOL_DEFINITIONS,
  ...DEFAULT_MUTATION_TOOL_DEFINITIONS,
];
