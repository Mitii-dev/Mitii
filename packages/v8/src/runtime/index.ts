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
  verifyFinish,
  verifyFinishAsync,
} from "./flow/steps/11-VerifyFinish";
export type { VerifyFinishSketch } from "./flow/steps/11-VerifyFinish";
export { executeRuntimeStart } from "./flow/ExecuteRuntimeStart";
export { executeRuntimeResume } from "./flow/ExecuteRuntimeResume";

export { verificationRequestSchema } from "./contracts/verify/VerificationRequest";
export type {
  VerificationRequest,
  VerificationOnFailure,
} from "./contracts/verify/VerificationRequest";
export { verificationOutcomeSchema } from "./contracts/verify/VerificationOutcome";
export type { VerificationOutcome } from "./contracts/verify/VerificationOutcome";
export { verificationBaselineSnapshotSchema } from "./contracts/verify/VerificationBaselineSnapshot";
export type { VerificationBaselineSnapshot } from "./contracts/verify/VerificationBaselineSnapshot";
export { taskHandoffNoteSchema } from "./contracts/handoff/TaskHandoffNote";
export type { TaskHandoffNote } from "./contracts/handoff/TaskHandoffNote";
export { situationPackSchema } from "./contracts/orient/SituationPack";
export type { SituationPack } from "./contracts/orient/SituationPack";
export { contextBundleSchema } from "./contracts/enrich/ContextBundle";
export type {
  ContextBundle,
  CacheClass,
} from "./contracts/enrich/ContextBundle";
export { scopeVerdictSchema } from "./contracts/orient/ScopeVerdict";
export type {
  ScopeVerdict,
  ScopeVerdictEvidence,
  ScopeReadHint,
} from "./contracts/orient/ScopeVerdict";
export { intentCuesSchema } from "./contracts/orient/IntentCues";
export type { IntentCues } from "./contracts/orient/IntentCues";
export { taskDirectionAssessmentSchema } from "./contracts/assess/TaskDirectionAssessment";
export type { TaskDirectionAssessment } from "./contracts/assess/TaskDirectionAssessment";
export {
  runtimeStartInputSchema,
  runtimeSituationSnapshotSchema,
  runtimeResumeInputSchema,
  runtimeRunStatusSchema,
  runtimeRunResultSchema,
} from "./contracts";
export type {
  RuntimeStartInput,
  RuntimeSituationSnapshot,
  RuntimeResumeInput,
  RuntimeRunStatus,
  RuntimeRunResult,
} from "./contracts";

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
export {
  adaptAgentStartMessage,
  adaptHostStartToRuntime,
} from "./helpers/adapt/AdaptAgentStartMessage";
export type { HostStartLoose } from "./helpers/adapt/AdaptAgentStartMessage";
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

export * from "./surface/PlanDiscoverStore";
export * from "./surface/VerifyGatesAdapters";
