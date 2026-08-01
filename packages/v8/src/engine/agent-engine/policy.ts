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
  /** Fallback preferred batch size when grant omits mutationBudget. */
  defaultPreferredBatchSize: 3,
  /** Fallback hard patch cap when grant omits mutationBudget. */
  defaultMaxPatchesPerCall: 8,
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
