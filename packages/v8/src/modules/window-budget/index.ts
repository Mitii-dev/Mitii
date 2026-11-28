/**
 * Window Budget public surface.
 *
 * Prefer `WindowBudgetPipeline` for new call sites. Free functions remain as
 * thin aliases for hosts during the engine rewrite.
 */

export { WindowBudgetPipeline } from "./flow/WindowBudgetPipeline";
export type { WindowBudgetPipelineDependencies } from "./flow/WindowBudgetPipeline";

export {
  WINDOW_BUDGET_SCHEMA_VERSION,
  LEGACY_DEFAULT_MAXIMUM_OUTPUT_TOKENS,
  WINDOW_BUDGET_REASON_CODES,
  WINDOW_BUDGET_REASON,
  WINDOW_BUDGET_EFFORT_REASON,
  WINDOW_BUDGET_MODE_REASON,
  WINDOW_BUDGET_STAGES,
  WINDOW_BUDGET_ERROR_CODES,
} from "./constants";

export { DEFAULT_WINDOW_BUDGET_POLICY } from "./defaults";

export {
  WINDOW_BUDGET_POLICY,
  mergeWindowBudgetPolicy,
  resolveWindowBudgetPolicy,
  WINDOW_BUDGET_BANDS,
  WINDOW_BUDGET_BAND,
  WINDOW_BUDGET_BAND_CEILINGS,
  WINDOW_BUDGET_BAND_TABLE,
  resolveWindowBudgetBand,
  windowBudgetBandDefinition,
  listWindowBudgetBands,
  WINDOW_BUDGET_EFFORTS,
  DEFAULT_WINDOW_BUDGET_EFFORT,
  WINDOW_BUDGET_EFFORT_OVERLAY,
  resolveWindowBudgetEffort,
  resolveEffortCompactionCeilings,
  scaleEffortCallBudget,
  WINDOW_BUDGET_MODES,
  DEFAULT_WINDOW_BUDGET_MODE,
  WINDOW_BUDGET_MODE_OVERLAY,
  resolveWindowBudgetMode,
  windowBudgetModeOverlay,
  WINDOW_BUDGET_MODEL_PROFILES,
  resolveWindowBudgetModelProfile,
  COMPACT_TOOL_LOOP_OUTPUT_HARD_CAP,
  resolveToolLoopMaxOutputTokens,
  DEFAULT_DISCOVERY_PASS_BUDGET,
  resolveDiscoveryPassBudget,
  scaleDiscoveryPassBudget,
  assertDiscoveryBudgetsMonotonic,
} from "./rules";
export type {
  ResolveWindowBudgetPolicyInput,
  ResolvedWindowBudgetPolicy,
  WindowBudgetBand,
  WindowBudgetBandDefinition,
  WindowBudgetEffort,
  WindowBudgetEffortOverlay,
  WindowBudgetMode,
  WindowBudgetModeOverlay,
  WindowBudgetModelProfile,
  DiscoveryPassBudget,
  DiscoveryTaskSize,
} from "./rules";

export {
  deriveWindowPolicy,
  resolveGenerationCeiling,
} from "./flow/steps";

export {
  windowBudgetInputSchema,
  windowBudgetPolicySchema,
  windowBudgetPolicyOverridesSchema,
  windowPolicySchema,
  windowBudgetReasonCodeSchema,
  windowBudgetStageTraceSchema,
  WindowBudgetError,
  windowBudgetErrorCodeSchema,
  noopModuleLogger,
} from "./contracts";
export type {
  WindowBudgetInput,
  WindowBudgetPolicy,
  WindowBudgetPolicyOverrides,
  WindowPolicy,
  WindowPolicySections,
  WindowPolicyCompaction,
  WindowPolicyMutation,
  WindowPolicyPlanning,
  WindowPolicyRun,
  WindowPolicySkills,
  WindowPolicyTaskList,
  WindowPolicyCarry,
  WindowPolicyInjection,
  WindowPolicyFragments,
  WindowBudgetReasonCode,
  WindowBudgetStageTrace,
  WindowBudgetErrorCode,
  ModuleLoggerPort,
} from "./contracts";
