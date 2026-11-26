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
export { shouldRunPlanPipeline, rejectHollowPlan } from "./helpers/plan";
export {
  selectRouteBody,
  clarifyRouteBody,
  answerRouteBody,
  diagnoseRouteBody,
  planRouteBody,
  executeRouteBody,
} from "./helpers/routes";
export type { RouteBodyPlan } from "./helpers/routes";
export { verifyFinish } from "./flow/steps/11-VerifyFinish";
export type { VerifyFinishSketch } from "./flow/steps/11-VerifyFinish";
export { shouldEmitHeartbeat } from "./helpers/heartbeat/ShouldEmitHeartbeat";
export { countTurnHeartbeats } from "./helpers/heartbeat/CountTurnHeartbeats";
export { stampMcpAttach, revokeMcpAttach } from "./helpers/mcp/StampMcpAttach";
export { buildTaskHandoff } from "./helpers/handoff/BuildTaskHandoff";
export type { TaskHandoff } from "./helpers/handoff/BuildTaskHandoff";
export { commitRuntimeMemory } from "./helpers/memory/CommitRuntimeMemory";
export { isApprovedPlanFresh } from "./helpers/build/IsApprovedPlanFresh";
export {
  checkPlanFreshness,
  buildPlanFingerprint,
} from "./helpers/build/CheckPlanFreshness";
export { assembleRuntimeParityFields } from "./helpers/parity/AssembleRuntimeParityFields";
export { situationPackSchema } from "./contracts/orient/SituationPack";
export type { SituationPack } from "./contracts/orient/SituationPack";
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

export { evaluateSoftRails } from "./helpers/rails";
export type { SoftRailKind, SoftRailNudge } from "./helpers/rails";

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
} from "./ports";
export { createInlineVerificationRunner } from "./ports";

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
} from "./helpers/gates";
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
