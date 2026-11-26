export { toolGrantsEquivalent } from "./CompareToolGrants";

export { resolveRoute } from "./ResolveRoute";
export { isExplicitCreateAsk } from "./RouteCreateAsk";
export type { RouteResolution } from "./ResolveRoute";
export { isMutationIntent, isDiagnosisIntent } from "./RouteIntents";
export {
  looksLikeAgentVerificationRequest,
  looksLikeCodeReviewRequest,
} from "./RouteMessageSignals";

export { looksLikeWorkspaceBugReport } from "./LooksLikeWorkspaceBugReport";
export { looksLikePastedTestFailureDump } from "./LooksLikeWorkspaceBugReport";

export {
  resolvePlanningDepth,
  isMultiOutcomeCampaignAsk,
} from "./ResolvePlanningDepth";
export type { PlanningDepthResolution } from "./ResolvePlanningDepth";

export {
  isBroadSharedScopeRepair,
  isLocalizedSmallClearAsk,
  isConcreteLocalizedMutationAsk,
  shouldElevateSharedScopeRisk,
  shouldRecommendChangeImpact,
} from "./ClassifySharedScopeRepair";

export {
  resolveFastPath,
  extractExplicitFilePaths,
  FAST_PATH_DECLINE_REASONS,
} from "./ResolveFastPath";
export type {
  FastPathResolution,
  FastPathDeclineReason,
} from "./ResolveFastPath";

export {
  detectBehavioralAskSignals,
  looksLikeBehavioralAsk,
} from "./DetectBehavioralAsk";
export type { BehavioralAskSignals } from "./DetectBehavioralAsk";

export { resolvePlanGate } from "./ResolvePlanGate";
export type { PlanGateResolution } from "./ResolvePlanGate";

export { planRoute } from "./RoutePlanner";
export type { RoutePlanResult } from "./RoutePlanner";

export { compileGrant } from "./GrantCompiler";
export type { CompiledGrantResult } from "./GrantCompiler";

export {
  buildToolGrant,
  extractNetworkHosts,
  isExplicitWebSearchAsk,
  needsLiveWebEvidence,
  selectGrantProfile,
  GRANT_PROFILES,
} from "./BuildToolGrant";
export type { ToolGrantResolution, GrantProfile } from "./BuildToolGrant";

export { looksLikeVcsHistoryRewrite } from "./DetectVcsHistoryRewrite";

export {
  extractExplicitMutationFence,
  hasExplicitEditLimit,
} from "./ExtractExplicitMutationFence";
export { looksLikeWorkspaceRootMutation } from "./ResolveGrantPathScopes";
export { applyAntiNagAsk } from "./ApplyAntiNagAsk";
export type { AntiNagAskInput, AntiNagAskResult } from "./ApplyAntiNagAsk";
export { mapPlanningHintToDepth } from "./MapPlanningHintToDepth";
export { compileGrantFromPlate } from "./CompileGrantFromPlate";
export type {
  CompileGrantFromPlateInput,
  CompileGrantFromPlateResult,
} from "./CompileGrantFromPlate";
export {
  attachUnifiedScopes,
  deriveUnifiedScopes,
} from "./AttachUnifiedScopes";
export type { UnifiedGrantScopes } from "./AttachUnifiedScopes";
export { toModelToolSurface } from "./ToModelToolSurface";
export type { GrantToolSurface } from "./ToModelToolSurface";
export {
  applyUpgradePlate,
  isRegisteredUpgradePlate,
} from "./ApplyUpgradePlate";
export type { ApplyUpgradePlateInput } from "./ApplyUpgradePlate";

export {
  buildVerificationGrant,
  DEFAULT_VERIFICATION_COMMAND_PREFIXES,
  DEFAULT_AGENT_READONLY_COMMAND_PREFIXES,
} from "./BuildVerificationGrant";

export { resolveMutationBudget } from "./ResolveMutationBudget";
export type {
  MutationBudgetProfile,
  MutationBudgetResolution,
} from "./ResolveMutationBudget";

export { resolveVerificationRequirement } from "./ResolveVerificationRequirement";
export type { VerificationResolution } from "./ResolveVerificationRequirement";

export { resolvePreflightBuild } from "./ResolvePreflightBuild";
export type { PreflightBuildResolution } from "./ResolvePreflightBuild";

export { scanPromptInjection } from "./ScanPromptInjection";
export type { InjectionScanResult } from "./ScanPromptInjection";

export {
  intersectUserSafetyRules,
  grantNeverWidens,
  resolveApprovalSkipCategories,
} from "./IntersectUserSafetyRules";
export type { IntersectUserSafetyResult } from "./IntersectUserSafetyRules";

export {
  formatEffectiveGrant,
  formatEffectiveGrantJson,
} from "./FormatEffectiveGrant";

export {
  APPROVAL_PRESET_COPY,
  VSCODE_APPROVAL_PRESETS,
  getApprovalPresetCopy,
  formatApprovalPresetHelp,
} from "./ApprovalPresetCopy";
export type {
  ApprovalPresetCopy,
  VsCodeApprovalPreset,
} from "./ApprovalPresetCopy";

export {
  compileDecisionBrief,
  formatDecisionBriefForPrompt,
} from "./CompileDecisionBrief";
