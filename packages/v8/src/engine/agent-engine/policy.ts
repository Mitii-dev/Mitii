import type { ModelToolDefinition } from "../../modules/model-gateway";
import {
  listBuiltinMutationModelToolDefinitions,
  listBuiltinReadOnlyModelToolDefinitions,
} from "../tool-runtime";

/**
 * Base working standards for loop / stall / recovery thresholds.
 *
 * Window-specific permanent tuning lives in
 * `policy/loopPolicyBands.ts` (compact / standard / wide).
 * Developer `mitii.loopPolicy.*` overrides are lab-only deltas on top.
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
   * diagnosis instead of apply_patch. Kept at 2 across all bands so a
   * single stale-context miss can recover without enabling research essays.
   */
  maxUnfulfilledExecuteRecoveries: 2,
  /**
   * Max nudges when a structured review (review_findings_structured) ends
   * without any emit_review_finding tool call.
   */
  maxStructuredReviewRecoveries: 2,
  /**
   * Max recoveries after apply_patch/delete_file/move_file is rejected
   * (e.g. old_text_not_found). Kept separate from text-only unfulfilled
   * execute so a stale-hunk → targeted read → retry cycle can complete
   * without burning the single diagnosis nudge.
   */
  maxRejectedMutationRecoveries: 3,
  /**
   * One withheld mutation when change_impact_recommended and
   * analyze_change_impact has not yet succeeded on this run. A second attempt
   * proceeds so this does not deadlock against unfulfilled_execute recovery.
   */
  maxChangeImpactNudges: 1,
  /**
   * One withheld mutation when the active task's mustRead files are not yet
   * in this-loop reads or established facts. A second attempt proceeds so
   * this does not fight unfulfilled_execute recovery.
   */
  maxMustReadNudges: 1,
  /**
   * Extra grace turns after the first-mutation nudge when the model keeps
   * reading files instead of patching. Kept separate from text-only
   * unfulfilled execute so essays / rejected-tool loops do not get looser.
   */
  maxReadOnlyMutationRetryAttempts: 2,
  /**
   * Targeted read_file / read_many_files batches allowed after the mutation
   * nudge before failing. Broad list/glob/search still fails immediately.
   */
  maxPostNudgeEvidenceReadTurns: 2,
  /**
   * Max successful read/search/tool turns in execute mode before requiring the
   * first mutation attempt. This catches broad investigation loops that never
   * reach apply_patch. Shared across bands; compact may tighten further.
   */
  maxReadOnlyToolTurnsBeforeMutationNudge: 4,
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
  defaultPreferredBatchSize: 12,
  /** Fallback hard patch cap when grant omits mutationBudget. */
  defaultMaxPatchesPerCall: 24,
  /**
   * Flag context-loss re-reads when file-read calls exceed unique paths
   * by this ratio and at least `explorationRereadMinCalls` reads occurred.
   */
  explorationRereadRatio: 2,
  explorationRereadMinCalls: 6,
  /** One mid-loop nudge, then stop the spin. */
  maxExplorationStallNudges: 1,
  /**
   * Max user-approved Continue overrides after exploration stall walls.
   * Further stalls fall back to terminal fail/complete.
   */
  maxContinueOverrides: 2,
  /**
   * Extra model calls granted when the user Continues after budget_exhausted.
   * Without this, resume would immediately re-hit the same ceiling.
   */
  continueBudgetModelCallBump: 4,
  /**
   * Fallback remaining-error repairs when Window Policy is absent.
   * Window effort is the live cap (medium: 8). Stop earlier when
   * consecutive verifies stop improving.
   */
  maxVerificationRepairAttempts: 8,
  /** Stop repairing after this many consecutive non-improving verifies. */
  maxStalledVerificationRepairs: 2,
  /**
   * Diagnose / repository_answer: consecutive turns that only call the same
   * tool (e.g. read_diagnostics thrash) before nudging for a final answer.
   */
  maxRepeatedReadonlyToolTurnsBeforeAnswerNudge: 3,
  /** One nudge, then strip tools so the next turn must answer. */
  maxDiagnoseAnswerNudges: 1,
  /**
   * When a recovered turn was a mid-work analysis dump, keep only this many
   * characters in the transcript so leftover output budget remains for patches.
   */
  maxRecoveredAnalysisChars: 480,
  /**
   * Abort a model turn when the reasoning channel alone exceeds this many
   * characters with no content or tool deltas yet. Local thinking models can
   * stream unbounded reasoning that never hits max_tokens and burns the
   * harness wall clock (benchmark exit 124) before the first tool call.
   */
  maxReasoningCharsWithoutProgress: 12_000,
  /**
   * When the model advertises reasoning support, apply this ratio to
   * {@link maxReasoningCharsWithoutProgress} so thinking-only burns trip
   * earlier and recover into tools instead of Continue thrash.
   */
  reasoningProgressBudgetRatioWhenReasoningCapable: 0.5,
  /**
   * After this many successful file-body reads without any granted
   * code-intelligence tool, nudge once toward document_symbol / goto_definition.
   */
  maxFileReadsBeforeCodeIntelNudge: 8,
  /** Max code-intel adoption nudges per run (0 disables). */
  maxCodeIntelAdoptionNudges: 1,
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
