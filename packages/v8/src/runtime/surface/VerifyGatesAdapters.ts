/** Public verify / gates / adapters / ports surface. */

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
} from "../helpers/verify";
export type { ChangeClass, ChangeClassSelectPolicy } from "../helpers/verify";
export {
  shouldEmitHeartbeat,
  countTurnHeartbeats,
  selectHeartbeatPolicy,
  shouldSaveHeartbeatCheckpoint,
  maybeSaveHeartbeatCheckpoint,
  buildHeartbeatCheckpoint,
  HEARTBEAT_CHECKPOINT_KIND,
} from "../helpers/heartbeat";
export { stampMcpAttach, revokeMcpAttach } from "../helpers/mcp/StampMcpAttach";
export { applyMcpMidRun } from "../helpers/mcp/ApplyMcpMidRun";
export { applyMcpMidRunToRunState } from "../helpers/mcp/ApplyMcpMidRunToRunState";
export {
  RunState,
  RUN_STATE_KEYS,
  isRunStateKey,
  buildCheckpointFromRunState,
  hydrateRunStateFromCheckpoint,
} from "../helpers/run-state";
export {
  replateDecisionOnPlanApprove,
  applyReplateToSnapshot,
  extractPlanWriteTargets,
  intersectScopesWithPlanTargets,
} from "../helpers/replate";
export {
  buildTaskHandoff,
  buildTaskHandoffNote,
  advanceTaskWithHandoff,
  reorderTaskListForSteer,
  selectBriefcaseHandoffPeaks,
  appendTaskHandoff,
  sanitizeHandoffText,
  softWarnTaskListLength,
} from "../helpers/handoff";
export type { TaskHandoff } from "../helpers/handoff/BuildTaskHandoff";
export { commitRuntimeMemory } from "../helpers/memory/CommitRuntimeMemory";
export { isApprovedPlanFresh } from "../helpers/build/IsApprovedPlanFresh";
export {
  checkPlanFreshness,
  buildPlanFingerprint,
} from "../helpers/build/CheckPlanFreshness";
export { assembleRuntimeParityFields } from "../helpers/parity/AssembleRuntimeParityFields";
export { composeRuntime } from "../adapters/compose/ComposeRuntime";
export type { ComposeRuntimeOptions } from "../adapters/compose/ComposeRuntime";
export {
  InMemoryRuntimeSessionStore,
  saveRuntimeSessionCarry,
  saveRuntimeGateCheckpoint,
  readStoreSnapshotFromCheckpoint,
} from "../helpers/checkpoint";
export type {
  RuntimeSessionCarry,
  RuntimeSessionStorePort,
} from "../helpers/checkpoint";
export { completeViaLlmPort } from "../adapters/model/CompleteViaLlmPort";
export { scriptedModelPort } from "../adapters/model/ScriptedModelPort";
export { executeViaCallback } from "../adapters/tools/ExecuteViaCallback";
export { executeViaToolRuntime } from "../adapters/tools/ExecuteViaToolRuntime";
export { grantSurfaceToToolGrant } from "../adapters/tools/GrantSurfaceToToolGrant";
export {
  createAgentRunHandleFromRuntimeResult,
  mapRuntimeGateToSuspensionKind,
} from "../adapters/bridge/AgentRunHandleFromRuntimeResult";
export { adaptEngineResumeToRuntime } from "../adapters/bridge/AdaptEngineResumeToRuntime";
export type { AdaptedEngineResume } from "../adapters/bridge/AdaptEngineResumeToRuntime";
export { wrapEngineWithRuntimeShell } from "../adapters/bridge/WrapEngineWithRuntimeShell";
export type { RuntimeShellEngineSurface } from "../adapters/bridge/WrapEngineWithRuntimeShell";
export {
  createLiveAgentRunHandleFromRuntimeStart,
  createLiveAgentRunHandleFromRuntimeResume,
} from "../adapters/bridge/CreateLiveAgentRunHandle";
export { RuntimeEventChannel } from "../helpers/events/RuntimeEventChannel";
export type { RuntimeEventSink } from "../helpers/events/RuntimeEventChannel";
export { createPipelineVerificationRunner } from "../adapters/verification/CreatePipelineVerificationRunner";
export type { VerificationInputFactory } from "../adapters/verification/CreatePipelineVerificationRunner";
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
  RuntimePromptConstructionPort,
} from "../ports";
export { createInlineVerificationRunner } from "../ports";
export {
  createInlineSkillsRetrieval,
  createInlineMemoryRetrieval,
  createInlineRepoRetrieval,
  createSkillsPipelineRetrieval,
  createMemoryPipelineRetrieval,
  createRepoContextPipelineRetrieval,
} from "../adapters/enrich";
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
} from "../helpers/gates";
export type { PolicyGateConcern, PolicyGateOwner } from "../helpers/gates";
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
} from "../helpers/gates";
