/** Public plan / discovery / store / enrich surface. */

export {
  shouldRunPlanPipeline,
  rejectHollowPlan,
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
} from "../helpers/plan";
export {
  shouldRunDiscoveryPass,
  buildReadonlyDiscoveryGrant,
  enforceDiscoveryQualityFloor,
  runDiscoveryPass,
  countProductiveReads,
  isProductiveDiscoveryPath,
} from "../helpers/plan-discovery";
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
