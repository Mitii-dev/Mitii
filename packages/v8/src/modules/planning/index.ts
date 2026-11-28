export {
  PLANNING_SCHEMA_VERSION,
  PLANNING_STATUSES,
  PLAN_STEP_RISK_LEVELS,
  PLAN_CHANGE_IMPACTS,
  PLAN_CONTEXT_KINDS,
  PLAN_STRATEGIES,
  PLANNING_REASON_CODES,
  PLANNING_ERROR_CODES,
  PLANNING_REASON,
  PLANNING_STAGES,
  PLANNING_MESSAGES,
} from "./constants";

export {
  DEFAULT_PLANNING_BUDGET_TOKENS,
  DEFAULT_PLAN_CHARACTERS_PER_TOKEN,
  DEFAULT_MAX_PLAN_PHASES,
  DEFAULT_MAX_STEPS_PER_PHASE,
  DEFAULT_MAX_OPEN_QUESTIONS,
} from "./defaults";

export { PLANNING_WORKING_SET_POLICY } from "./rules";

export { PlanningPipeline } from "./flow/PlanningPipeline";
export {
  compileDiscoveryBrief,
  collectDiscoveryImpactSeedPaths,
  formatClarifyAsAnswer,
  formatPlanAsAnswer,
  formatPlanSummaryAnswer,
  inferPlanStrategyFromArtifact,
  serializePlanForPrompt,
  serializePlanText,
} from "./flow/PlanningPipeline";
export {
  draftClarifyFromDiscovery,
  buildFallbackClarifyDraft,
} from "./adapters/llm";
export {
  remapPathThroughScaffoldMapping,
  remapScaffoldChangeSurfaces,
  resolveScaffoldPackageMapping,
} from "./helpers/remapScaffoldChangeSurfaces";
export type { PlanStrategyResolution } from "./flow/PlanningPipeline";

export {
  resolvePlanStrategy,
  resolvePlanStrategyRules,
  isRepairIntent,
  isArchitecturePlanningAsk,
  isMediumOrLargerTask,
} from "./helpers/ResolvePlanStrategy";

export {
  changeLikePhaseName,
  isConcretePlanTargetRef,
  isConcretePlanVerification,
} from "./helpers/concretePlanTargets";

export { thinDiscoveryBriefForClarify } from "./helpers/thinDiscoveryBriefForClarify";
export {
  hasResolvedPlanScopeChoice,
  resolvePlanScopeId,
  collectCompletedPlanScopeIds,
  PLAN_SCOPE_DEFS,
  PLAN_SCOPE_ORDER,
} from "./helpers/planScopeChoice";
export type { PlanScopeId, PlanScopeChoiceParams } from "./helpers/planScopeChoice";
export {
  askNeedsPlanScopeFork,
} from "./helpers/askNeedsPlanScopeFork";
export type { PlanScopeForkEvidence } from "./helpers/askNeedsPlanScopeFork";
export {
  boundPreferredPathsForPlanScope,
  scorePathForPlanScope,
  planScopeDiscoveryHint,
  planScopeProcessHint,
  planScopeSearchQueries,
} from "./helpers/planScopeBounds";
export {
  remainingPlanScopeIds,
  formatNextPlanPhaseOffer,
  appendNextPlanPhaseOffer,
} from "./helpers/planScopeCampaign";

export {
  planningInputSchema,
  planningTaskEvidenceSchema,
  planningTaskSizeSchema,
  planningSkillHintSchema,
  explorationDepthSchema,
  planningScopedRepoMapSchema,
  planningBuildEvidenceSchema,
  planningImpactReportSchema,
  DISCOVERY_OBSERVATION_LIMITS,
  discoveryBriefSchema,
  discoveryObservationSchema,
  planArtifactSchema,
  planPhaseSchema,
  planStepSchema,
  planRiskSchema,
  planAlternativeSchema,
  planVerificationSchema,
  planDimensionsSchema,
  planContextRefSchema,
  planStrategySchema,
  planStrategyDecisionSchema,
  discoveredPlanStepSchema,
  discoveredPlanDraftSchema,
  planClarifyOptionSchema,
  planClarifyDraftSchema,
  planningResultSchema,
  PlanningError,
  planningErrorCodeSchema,
} from "./contracts";
export type {
  PlanningInput,
  PlanningParsedInput,
  PlanningTaskEvidence,
  PlanningSkillHint,
  ExplorationDepth,
  PlanningScopedRepoMap,
  PlanningBuildEvidence,
  PlanningImpactReport,
  DiscoveryBrief,
  DiscoveryObservation,
  DiscoveryFileRef,
  DiscoveryTarget,
  DiscoveryChangeSurface,
  DiscoveryVerificationHint,
  PlanArtifact,
  PlanChangeImpact,
  PlanPhase,
  PlanStep,
  PlanRisk,
  PlanAlternative,
  PlanVerification,
  PlanDimensions,
  PlanContextRef,
  PlanContextKind,
  PlanStrategy,
  PlanStrategyDecision,
  DiscoveredPlanStep,
  DiscoveredPlanDraft,
  PlanClarifyOption,
  PlanClarifyDraft,
  PlanningResult,
  PlanningStatus,
  PlanningReasonCode,
  PlanStepRiskLevel,
  PlanningErrorCode,
} from "./contracts";

export type { PlanningLlmPort } from "./ports/PlanningLlmPort";
export type { ModuleLoggerPort } from "./ports/ModuleLoggerPort";
export { noopModuleLogger } from "./ports/ModuleLoggerPort";

/** Bridge maps — understanding → planning evidence / impact. */
export {
  mapUnderstandingToPlanningEvidence,
  collectPlanningImpactReports,
} from "./helpers";
