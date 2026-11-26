export {
  GATE_PHASES,
  GATE_KINDS,
  CORE_GATE_KINDS,
  EXTENDED_GATE_KINDS,
  TERMINAL_KINDS,
  CLARIFY_ORIGINS,
  CONTINUE_REASONS,
  LEGACY_SUSPENSION_KIND_MAP,
} from "./constants";
export type {
  GatePhase,
  GateKind,
  TerminalKind,
  ClarifyOrigin,
  ContinueReason,
} from "./constants";

export { gateKindSchema, terminalKindSchema, gateVerdictSchema } from "./kinds";
export type { GateVerdict } from "./kinds";

export type {
  GateContext,
  GatePredicate,
  ResumePlan,
  ResumeReenter,
  ApplyGateResult,
  GateCheckpointStorePort,
  RuntimeGateCheckpoint,
} from "./types";

export { evaluateGates } from "./EvaluateGates";
export { applyGate } from "./ApplyGate";
export type { ApplyGateDeps } from "./ApplyGate";
export { buildCheckpoint } from "./BuildCheckpoint";
export { InMemoryGateCheckpointStore } from "./InMemoryGateCheckpointStore";
export { mapLegacySuspensionKind } from "./MapLegacySuspensionKind";
export {
  mapLegacyContinueReason,
  LEGACY_CONTINUE_REASON_MAP,
  isLegacyContinueReason,
} from "./MapLegacyContinueReason";
export type { LegacyContinueReason } from "./MapLegacyContinueReason";
export { buildBudgetWallRationale } from "./BuildBudgetWallRationale";
export type { BuildBudgetWallRationaleInput } from "./BuildBudgetWallRationale";
export { buildBudgetWallResetMessage } from "./BuildBudgetWallResetMessage";
export type { BuildBudgetWallResetMessageInput } from "./BuildBudgetWallResetMessage";
export { shouldOfferBudgetWallContinue } from "./ShouldOfferBudgetWallContinue";
export { predicatesForPhase } from "./catalog";

export {
  shouldSuspendForPlanScopeFork,
  shouldForceCampaignPhaseLock,
  requireClarificationAfterPlan,
} from "./predicates/RequireClarificationAfterPlan";

export { resumeClarification } from "./resume/ResumeClarification";
export { resumePlanDecision } from "./resume/ResumePlanDecision";
export { resumeMutationApproval } from "./resume/ResumeMutationApproval";
export { resumeGrantExpansion } from "./resume/ResumeGrantExpansion";
export { resumeContinueDecision } from "./resume/ResumeContinueDecision";
export { resumeCheckpointConflict } from "./resume/ResumeCheckpointConflict";
export { resumeExternalSideEffect } from "./resume/ResumeExternalSideEffect";
export { resumeAuthOrDependency } from "./resume/ResumeAuthOrDependency";
export type { AuthOrDependencyAction } from "./resume/ResumeAuthOrDependency";

export {
  POLICY_GATE_OWNER_MAP,
  POLICY_GATE_CONCERNS,
  resolvePolicyGateOwner,
} from "./PolicyGateOwnerMap";
export type { PolicyGateConcern, PolicyGateOwner } from "./PolicyGateOwnerMap";
