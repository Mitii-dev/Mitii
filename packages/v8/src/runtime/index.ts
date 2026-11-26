/**
 * Public runtime surface (intentional only — never barrel private helpers).
 */
export {
  RUNTIME_SCHEMA_VERSION,
  RUNTIME_REASON_CODES,
  GRANT_PROFILES,
} from "./constants";
export type { RuntimeReasonCode, GrantProfile } from "./constants";
export { RUNTIME_DEFAULTS } from "./defaults";
export type { RuntimeDefaults } from "./defaults";

export { RUNTIME_FLOW_STEP_IDS, isRuntimeFlowStepId } from "./flow/order";
export type { RuntimeFlowStepId } from "./flow/order";
export { RuntimePipeline } from "./flow/Pipeline";
export { runEarlyPipeline } from "./flow/RunEarlyPipeline";
export type { RunEarlyPipelineResult } from "./flow/RunEarlyPipeline";
export { runThroughPlanPipeline } from "./flow/RunThroughPlanPipeline";
export type { RunThroughPlanPipelineResult } from "./flow/RunThroughPlanPipeline";
export { runThroughTurnLoop } from "./flow/RunThroughTurnLoop";
export type { RunThroughTurnLoopResult } from "./flow/RunThroughTurnLoop";
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
} from "./helpers/plan";
export type {
  SteerPlanPatch,
  PlanExitKind,
  ResolvePlanExitResult,
  AssertWindowBandResult,
} from "./helpers/plan";
export {
  selectRouteBody,
  clarifyRouteBody,
  answerRouteBody,
  diagnoseRouteBody,
  planRouteBody,
  executeRouteBody,
} from "./helpers/routes";
export type { RouteBodyPlan } from "./helpers/routes";
export {
  verifyFinish,
  verifyFinishAsync,
} from "./flow/steps/11-VerifyFinish";
export type { VerifyFinishSketch } from "./flow/steps/11-VerifyFinish";
export { verificationRequestSchema } from "./contracts/verify/VerificationRequest";
export type {
  VerificationRequest,
  VerificationOnFailure,
} from "./contracts/verify/VerificationRequest";
export { verificationOutcomeSchema } from "./contracts/verify/VerificationOutcome";
export type { VerificationOutcome } from "./contracts/verify/VerificationOutcome";
export { verificationBaselineSnapshotSchema } from "./contracts/verify/VerificationBaselineSnapshot";
export type { VerificationBaselineSnapshot } from "./contracts/verify/VerificationBaselineSnapshot";
export {
  selectVerificationPolicy,
  runVerificationPhase,
  commitMemoryOnFinish,
  captureVerificationBaseline,
  compareAgainstBaseline,
  resolveVerificationBudgets,
  DEFAULT_VERIFICATION_BUDGETS,
  runWithVerifyWall,
  omitHeavyVerificationChecks,
  isHeavyVerificationCandidate,
  discoverChecksFromCatalog,
  classifyChangedPaths,
  selectPolicyForChangedPaths,
  orderChecksFastFirst,
  CHANGE_CLASS_SELECT_TABLE,
} from "./helpers/verify";
export type { ChangeClass, ChangeClassSelectPolicy } from "./helpers/verify";
export {
  shouldEmitHeartbeat,
  countTurnHeartbeats,
  selectHeartbeatPolicy,
  shouldSaveHeartbeatCheckpoint,
  maybeSaveHeartbeatCheckpoint,
  buildHeartbeatCheckpoint,
  HEARTBEAT_CHECKPOINT_KIND,
} from "./helpers/heartbeat";
export { stampMcpAttach, revokeMcpAttach } from "./helpers/mcp/StampMcpAttach";
export { applyMcpMidRun } from "./helpers/mcp/ApplyMcpMidRun";
export { applyMcpMidRunToRunState } from "./helpers/mcp/ApplyMcpMidRunToRunState";
export {
  RunState,
  RUN_STATE_KEYS,
  isRunStateKey,
  buildCheckpointFromRunState,
  hydrateRunStateFromCheckpoint,
} from "./helpers/run-state";
export {
  replateDecisionOnPlanApprove,
  applyReplateToSnapshot,
  extractPlanWriteTargets,
  intersectScopesWithPlanTargets,
} from "./helpers/replate";
export {
  buildTaskHandoff,
  buildTaskHandoffNote,
  advanceTaskWithHandoff,
  reorderTaskListForSteer,
  selectBriefcaseHandoffPeaks,
  appendTaskHandoff,
  sanitizeHandoffText,
  softWarnTaskListLength,
} from "./helpers/handoff";
export type { TaskHandoff } from "./helpers/handoff/BuildTaskHandoff";
export { taskHandoffNoteSchema } from "./contracts/handoff/TaskHandoffNote";
export type { TaskHandoffNote } from "./contracts/handoff/TaskHandoffNote";
export { commitRuntimeMemory } from "./helpers/memory/CommitRuntimeMemory";
export { isApprovedPlanFresh } from "./helpers/build/IsApprovedPlanFresh";
export {
  checkPlanFreshness,
  buildPlanFingerprint,
} from "./helpers/build/CheckPlanFreshness";
export { assembleRuntimeParityFields } from "./helpers/parity/AssembleRuntimeParityFields";
export { situationPackSchema } from "./contracts/orient/SituationPack";
export type { SituationPack } from "./contracts/orient/SituationPack";
export { contextBundleSchema } from "./contracts/enrich/ContextBundle";
export type {
  ContextBundle,
  CacheClass,
} from "./contracts/enrich/ContextBundle";
export {
  buildFullContextBundle,
  refreshContextBundleLight,
  retrieveEnrichMaterials,
  prioritizeOmissions,
  sectionBudgetsFromWindowPolicy,
  ENRICH_OMISSION_PRIORITY,
} from "./helpers/enrich";
export type { EnrichOmissionKind, EnrichSectionBudgets } from "./helpers/enrich";
export { scopeVerdictSchema } from "./contracts/orient/ScopeVerdict";
export type {
  ScopeVerdict,
  ScopeVerdictEvidence,
  ScopeReadHint,
} from "./contracts/orient/ScopeVerdict";
export { intentCuesSchema } from "./contracts/orient/IntentCues";
export type { IntentCues } from "./contracts/orient/IntentCues";
export {
  buildScopeVerdict,
  extractFocusPaths,
  resolveWorkRoot,
  resolveRelatedProjects,
  buildOrientSurroundings,
  resolveConfigNearFocus,
  extractIntentCues,
} from "./helpers/orient";
export { scopesFromVerdict } from "./helpers/grant/ScopesFromVerdict";
export { taskDirectionAssessmentSchema } from "./contracts/assess/TaskDirectionAssessment";
export type { TaskDirectionAssessment } from "./contracts/assess/TaskDirectionAssessment";

export {
  createEmptyStore,
  storeSchema,
  StoreManager,
  getStoreSlice,
  setStoreSlice,
  markStoreCancelling,
  buildStoreSnapshot,
  storeFromSnapshot,
} from "./helpers/store";
export type { Store, StoreClock, StoreSnapshot } from "./helpers/store";

export {
  toolInvocationRecordSchema,
  appendToolInvocation,
  settleToolInvocation,
  buildIdempotencyKey,
  findByIdempotencyKey,
} from "./helpers/tool-journal";
export type { ToolInvocationRecord } from "./helpers/tool-journal";

export {
  GRANT_DENY_REASONS,
  isGrantDenyReason,
  checkToolAgainstGrant,
  classifyToolEffect,
  needsMutationApproval,
  toModelToolSurface,
} from "./tools";
export type {
  GrantDenyReason,
  GrantSurface,
  ToolEffectClass,
  ToolGrantCheckResult,
} from "./tools";

export { evaluateSoftRails, assessBlastRadius } from "./helpers/rails";
export type {
  SoftRailKind,
  SoftRailNudge,
  AssessBlastRadiusInput,
  AssessBlastRadiusResult,
  BlastRadiusEscalate,
} from "./helpers/rails";

export {
  formatTaskListForBriefcase,
  updateTaskListOnSettle,
  extractChangedPathsFromToolArgs,
  applyTaskSettleToStore,
} from "./helpers/task";

export {
  runtimeStartInputSchema,
  runtimeResumeInputSchema,
  runtimeRunStatusSchema,
  runtimeRunResultSchema,
} from "./contracts";
export type {
  RuntimeStartInput,
  RuntimeResumeInput,
  RuntimeRunStatus,
  RuntimeRunResult,
} from "./contracts";
export {
  adaptAgentStartMessage,
  adaptHostStartToRuntime,
} from "./helpers/adapt/AdaptAgentStartMessage";
export type { HostStartLoose } from "./helpers/adapt/AdaptAgentStartMessage";
export { executeRuntimeStart } from "./flow/ExecuteRuntimeStart";
export { executeRuntimeResume } from "./flow/ExecuteRuntimeResume";

export { composeRuntime } from "./adapters/compose/ComposeRuntime";
export type { ComposeRuntimeOptions } from "./adapters/compose/ComposeRuntime";
export {
  InMemoryRuntimeSessionStore,
  saveRuntimeSessionCarry,
  saveRuntimeGateCheckpoint,
  readStoreSnapshotFromCheckpoint,
} from "./helpers/checkpoint";
export type {
  RuntimeSessionCarry,
  RuntimeSessionStorePort,
} from "./helpers/checkpoint";
export { completeViaLlmPort } from "./adapters/model/CompleteViaLlmPort";
export { scriptedModelPort } from "./adapters/model/ScriptedModelPort";
export { executeViaCallback } from "./adapters/tools/ExecuteViaCallback";
export { executeViaToolRuntime } from "./adapters/tools/ExecuteViaToolRuntime";
export { grantSurfaceToToolGrant } from "./adapters/tools/GrantSurfaceToToolGrant";
export {
  createAgentRunHandleFromRuntimeResult,
  mapRuntimeGateToSuspensionKind,
} from "./adapters/bridge/AgentRunHandleFromRuntimeResult";
export { adaptEngineResumeToRuntime } from "./adapters/bridge/AdaptEngineResumeToRuntime";
export type { AdaptedEngineResume } from "./adapters/bridge/AdaptEngineResumeToRuntime";
export { wrapEngineWithRuntimeShell } from "./adapters/bridge/WrapEngineWithRuntimeShell";
export type { RuntimeShellEngineSurface } from "./adapters/bridge/WrapEngineWithRuntimeShell";
export {
  createLiveAgentRunHandleFromRuntimeStart,
  createLiveAgentRunHandleFromRuntimeResume,
} from "./adapters/bridge/CreateLiveAgentRunHandle";
export { RuntimeEventChannel } from "./helpers/events/RuntimeEventChannel";
export type { RuntimeEventSink } from "./helpers/events/RuntimeEventChannel";
export { createPipelineVerificationRunner } from "./adapters/verification/CreatePipelineVerificationRunner";
export type { VerificationInputFactory } from "./adapters/verification/CreatePipelineVerificationRunner";
export type {
  RuntimeDependencies,
  RuntimeModelPort,
  RuntimeToolExecutorPort,
  RuntimeVerificationRunnerPort,
  RuntimeVerificationOutcome,
  RuntimeEnrichRetrievalPorts,
  RuntimeSkillsRetrievalPort,
  RuntimeMemoryRetrievalPort,
  RuntimeRepoContextRetrievalPort,
} from "./ports";
export { createInlineVerificationRunner } from "./ports";

export {
  createInlineSkillsRetrieval,
  createInlineMemoryRetrieval,
  createInlineRepoRetrieval,
  createSkillsPipelineRetrieval,
  createMemoryPipelineRetrieval,
  createRepoContextPipelineRetrieval,
} from "./adapters/enrich";

export {
  evaluateGates,
  applyGate,
  buildCheckpoint,
  InMemoryGateCheckpointStore,
  mapLegacySuspensionKind,
  GATE_PHASES,
  GATE_KINDS,
  CORE_GATE_KINDS,
  CONTINUE_REASONS,
  shouldSuspendForPlanScopeFork,
  shouldForceCampaignPhaseLock,
  resumeClarification,
  resumePlanDecision,
  resumeMutationApproval,
  resumeGrantExpansion,
  resumeContinueDecision,
  resumeCheckpointConflict,
  resumeExternalSideEffect,
  POLICY_GATE_OWNER_MAP,
  resolvePolicyGateOwner,
} from "./helpers/gates";
export type { PolicyGateConcern, PolicyGateOwner } from "./helpers/gates";
export type {
  GatePhase,
  GateKind,
  GateContext,
  GateVerdict,
  ResumePlan,
  ApplyGateResult,
  GateCheckpointStorePort,
  RuntimeGateCheckpoint,
  ApplyGateDeps,
  ClarifyOrigin,
  ContinueReason,
  TerminalKind,
} from "./helpers/gates";
