/** Public plan / discovery / store / enrich surface. */

export {
  shouldRunPlanPipeline,
  rejectHollowPlan,
  enforcePlanQuality,
  steerPlanArtifact,
  resolvePlanExit,
  assertWindowBand,
  splitPlanExecuteBudgets,
  deriveTaskListAfterPlan,
  beginDiscoveryTaskList,
  replaceDiscoveryWithExecution,
  emitPlanPhaseTelemetry,
} from "../helpers/plan";
export type {
  SteerPlanPatch,
  PlanExitKind,
  ResolvePlanExitResult,
  AssertWindowBandResult,
  PlanPhaseTelemetry,
  EnforcePlanQualityResult,
} from "../helpers/plan";
export { resolveOrientDepth } from "../helpers/orient";
export type {
  OrientDepth,
  ResolveOrientDepthResult,
} from "../helpers/orient";
export {
  shouldRunDiscoveryPass,
  buildReadonlyDiscoveryGrant,
  enforceDiscoveryQualityFloor,
  runDiscoveryPass,
  countProductiveReads,
  isProductiveDiscoveryPath,
  requiresPlanDiscoveryQualityFloor,
  isPlanDiscoveryEvidenceSufficient,
  ensurePlanClarifyDraft,
  formatPlanAnswerWithNextPhase,
  applyPlanScopePhaseBounds,
  boundImpactSeedsForPlanScope,
  applyPlanModeDiscoveryContract,
  isAgentWidePlanningScope,
  isPlanningFollowUp,
} from "../helpers/plan-discovery";
export {
  resolveShapedDiscoveryProfile,
  SHAPED_DISCOVERY_PROFILES,
  rankPathsForShapedDiscovery,
} from "../helpers/shaped-discovery";
export {
  selectRouteBody,
  clarifyRouteBody,
  answerRouteBody,
  diagnoseRouteBody,
  planRouteBody,
  executeRouteBody,
} from "../helpers/routes";
export type { RouteBodyPlan } from "../helpers/routes";
export {
  createEmptyStore,
  storeSchema,
  StoreManager,
  getStoreSlice,
  setStoreSlice,
  markStoreCancelling,
  buildStoreSnapshot,
  storeFromSnapshot,
  packTurn,
  packTurnOrBriefcase,
  buildBriefcase,
  buildBriefcaseViaPC,
  mapSketchToPromptConstructionInput,
} from "../helpers/store";
export type {
  Store,
  StoreClock,
  StoreSnapshot,
  PackTurnInput,
  ModelRequestSketch,
  BuildBriefcaseInput,
  BriefcaseSketch,
  BuildBriefcaseViaPCInput,
} from "../helpers/store";
export { createPromptConstructionPort } from "../adapters/prompt";
export {
  buildFullContextBundle,
  refreshContextBundleLight,
  retrieveEnrichMaterials,
  prioritizeOmissions,
  sectionBudgetsFromWindowPolicy,
  ENRICH_OMISSION_PRIORITY,
} from "../helpers/enrich";
export type { EnrichOmissionKind, EnrichSectionBudgets } from "../helpers/enrich";
export {
  formatTaskListForBriefcase,
  updateTaskListOnSettle,
  extractChangedPathsFromToolArgs,
  applyTaskSettleToStore,
} from "../helpers/task";
export {
  evaluateAfterToolGate,
  evaluateOnBudgetGate,
  resolveBudgetHardWall,
  mapGateVerdictToTurnGate,
} from "../helpers/turn";
export type {
  TurnLoopHubGate,
  TurnLoopHubGateKind,
} from "../helpers/turn";
export {
  ToolCallCache,
  getOrCreateToolCallCache,
} from "../helpers/store/ToolCallCache";
export type { ToolCallCacheEntry } from "../helpers/store/ToolCallCache";
export { attachHandoffsToCheckpointPayload } from "../helpers/checkpoint/AttachHandoffsToCheckpointPayload";
