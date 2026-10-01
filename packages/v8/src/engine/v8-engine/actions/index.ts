export { assembleToolCalls } from "./assembleToolCalls";
export { clampTurnMaximumOutputTokens } from "./clampTurnMaximumOutputTokens";
export {
  amendMessageWithClarification,
  buildClarificationPayload,
  resolveClarificationAnswer,
} from "./buildClarificationPayload";
export type {
  ClarificationOptionPayload,
  ClarificationPayload,
  ClarificationSession,
  ClarificationSessionOption,
} from "./buildClarificationPayload";
export {
  evaluateMutationCritic,
  MUTATION_CRITIC_VERDICTS,
} from "./evaluateMutationCritic";
export type {
  MutationCriticInput,
  MutationCriticResult,
  MutationCriticVerdict,
} from "./evaluateMutationCritic";
export {
  parseVerificationCritique,
  formatVerificationCritiqueWarnings,
  VERIFICATION_CRITIQUE_DECISIONS,
  VERIFICATION_CRITIQUE_SEVERITIES,
} from "./parseVerificationCritique";
export type {
  VerificationCritiqueDecision,
  VerificationCritiqueIssue,
  VerificationCritiqueResult,
  VerificationCritiqueSeverity,
} from "./parseVerificationCritique";
export { extractFileReadPaths } from "./extractFileReadPaths";
export {
  requiresStructuredReviewFindings,
  buildIncompleteReviewRecoveryMessage,
} from "./incompleteReviewFindings";
export {
  extractToolContentPaths,
  stripPathRangeSuffix,
  toolContentPathsOverlap,
  normalizeRepoPath,
} from "./extractToolContentPaths";
export {
  extractMutationTargetPaths,
  missingMustReadPaths,
  buildMustReadNudgeMessage,
} from "./assertBatchReads";
export {
  resolvePromptCacheClass,
  shouldPreserveModelLoopPrefix,
  PROMPT_CACHE_CLASSES,
} from "./resolvePromptCacheClass";
export type {
  PromptCacheClass,
  ResolvePromptCacheClassInput,
} from "./resolvePromptCacheClass";
export { estimateStickyMutableChars } from "./estimateStickyMutableChars";
export type { StickyMutableCharEstimate } from "./estimateStickyMutableChars";
export {
  extractEstablishedFact,
  extractCompilerErrorQueue,
  extractCompilerErrorPaths,
  extractOutOfScopePaths,
  upsertEstablishedFact,
  dropEstablishedFactsForPaths,
} from "./extractEstablishedFact";
export type { EstablishedFact } from "./extractEstablishedFact";
export {
  createLoopFileReadTracker,
  isExplorationRereadHeavy,
  recordLoopFileReads,
  resetLoopFileReadTracker,
  snapshotLoopFileReads,
} from "./isExplorationRereadHeavy";
export type {
  LoopFileReadTracker,
  ExplorationRereadThresholds,
} from "./isExplorationRereadHeavy";
export {
  resolveAgentEngineThresholds,
  agentEngineThresholdsSchema,
  agentEngineThresholdsOverridesSchema,
} from "./resolveAgentEngineThresholds";
export type {
  AgentEngineThresholds,
  AgentEngineThresholdsOverrides,
} from "./resolveAgentEngineThresholds";
export {
  resolveReasoningProgressBudget,
  resolveReasoningProgressBudgetChars,
  shouldNudgeCodeIntelAdoption,
  buildCodeIntelAdoptionNudgeMessage,
} from "./resolveReasoningAndCodeIntelNudges";
export type { ReasoningProgressBudget } from "./resolveReasoningAndCodeIntelNudges";
export {
  resolveLoopPolicyThresholds,
  resolveLoopPolicyBandThresholds,
} from "./resolveLoopPolicyThresholds";
export type {
  ResolveLoopPolicyThresholdsInput,
  ResolvedLoopPolicy,
} from "./resolveLoopPolicyThresholds";
export { buildExplorationStallNudge } from "./buildExplorationStallNudge";
export {
  buildStallContinueRationale,
  buildStallContinueResetMessage,
  buildBudgetWallRationale,
  buildBudgetWallResetMessage,
  shouldOfferStallContinue,
  shouldOfferBudgetWallContinue,
  BUDGET_WALL_REASONS,
} from "./buildStallContinueRationale";
export type { BudgetWallReason } from "./buildStallContinueRationale";
export { buildPreflightDiagnosticRepairInstruction } from "./buildPreflightDiagnosticRepairInstruction";
export { buildForcedMutationNudgeMessage } from "./buildForcedMutationNudgeMessage";
export { buildMissingModuleStubPatches } from "./buildMissingModuleStubPatches";
export {
  shouldForcePreflightRepairLock,
  preflightErrorsMatchUserRequest,
  preflightDiagnosticsForUserRequest,
} from "./shouldForcePreflightRepairLock";
export { buildVerificationRepairPrompt } from "./buildVerificationRepairPrompt";
export {
  diagnosticSourceLineKey,
  loadDiagnosticSourceLines,
} from "./loadDiagnosticSourceLines";
export { formatVerificationFailureAnswer, formatVerificationEvidence } from "./formatVerificationNarration";
export { summarizeToolCall } from "./summarizeToolCall";
export { truncateForEvent } from "./truncateForEvent";
export {
  applyExplorationSignal,
  calculateLoopInputBudgetTokens,
  clampRunBudget,
  toRunUsage,
} from "./windowPolicyRuntime";
export { shouldCaptureUnconditionalAgentPreflight } from "./shouldCaptureUnconditionalAgentPreflight";
export {
  decideVerificationGate,
  isUserGoalComplete,
  packageCompileEvidencePassed,
  failuresAreIgnorableWhenPackagePassed,
  isPackageScopedCheck,
  isWorkspaceRootCheck,
} from "./decideVerificationGate";
export type { VerificationGateDecision } from "./decideVerificationGate";
export { mapContextToPromptSlice } from "./mapContextToPromptSlice";
export { mapUnderstandingToSkillEvidence } from "./mapUnderstandingToSkillEvidence";
export { extractMemoryFileTargets } from "./extractMemoryFileTargets";
export { deriveSkillRepoEvidence } from "./deriveSkillRepoEvidence";
export type { SkillRepoEvidence } from "./deriveSkillRepoEvidence";
export { mapUnderstandingToPlanningEvidence } from "./mapUnderstandingToPlanningEvidence";
export { collectPlanningImpactReports } from "./collectPlanningImpactReports";
export { mergePromptInstructions } from "./mergePromptInstructions";
export {
  filterToolDefinitions,
  toToolIndexDefinition,
  isMcpToolName,
  isMcpAllowedByGrant,
  buildFullSchemaToolIds,
  DESCRIBE_TOOL_NAME,
  FULL_SCHEMA_TOOL_IDS,
  CORE_DISCOVERY_FULL_SCHEMA_TOOL_IDS,
  CORE_MUTATION_FULL_SCHEMA_TOOL_IDS,
  TOOL_INDEX_INPUT_SCHEMA,
  MCP_TOOL_NAME_PREFIX,
} from "./filterToolDefinitions";
export { annotateMutationToolDefinitions } from "./annotateMutationToolDefinitions";
export { serializeToolResultForModel } from "./serializeToolResultForModel";
export {
  buildOutputTruncationRecovery,
  isCompleteToolCall,
} from "./buildOutputTruncationRecovery";
export type { TruncationRecoveryPlan } from "./buildOutputTruncationRecovery";
export { buildMutationBudgetInstruction, buildMutationBudgetWorkingSetLines } from "./buildMutationBudgetInstruction";
export {
  serializeRecoverabilityWorkingSet,
} from "./serializeRecoverabilityWorkingSet";
export type { RecoverabilityWorkingSetInput } from "./serializeRecoverabilityWorkingSet";
export { estimateMutationPayloadCharacters } from "./estimateMutationPayloadCharacters";
export { buildInstructionBodies } from "./buildInstructionBodies";
export {
  refreshMemoryFactsForCompaction,
  clipMemoryFacts,
} from "./refreshMemoryFactsForCompaction";
export type { MemoryFact } from "./refreshMemoryFactsForCompaction";
export {
  compactModelLoopMessages,
  compactModelLoopMessagesFromWindowPolicy,
  stubToolResultsForCompletedPaths,
  estimateModelMessageTokens,
  estimateModelMessagesTokens,
  resolveCompactionPressure,
  resolveCompactionThresholds,
  COMPACTION_LADDER_STAGES,
} from "./compactModelLoopMessages";
export type {
  ModelLoopCompactionResult,
  ModelLoopCompactionPressure,
  ModelLoopCompactionThresholds,
  CompactionLadderStage,
} from "./compactModelLoopMessages";
export {
  buildIncompleteAnswerRecoveryMessage,
  hasLeakedToolCallMarkup,
  isEmptyAssistantTurn,
  isPseudoToolRequestAnswer,
  isTransitionalAssistantAnswer,
  isUnfinishedInvestigationAnswer,
  isMidWorkAnalysisDump,
  isDegenerateRepeatedAnswer,
  claimsPackageScriptsWithoutEvidence,
  shouldRecoverIncompleteAssistantTurn,
  synthesizeFallbackAnswer,
  compactRecoveredAssistantContent,
  selectUserFacingLoopAnswer,
  salvageUserFacingAnswerSection,
  stripInjectionComplianceEchoes,
  amendMessageWithPriorConversation,
  buildUnderstandingHistoryDigest,
} from "./isIncompleteAssistantTurn";

export { recoverLeakedToolCallsFromMarkup } from "./recoverLeakedToolCalls";
export { formatSkillPromptContent } from "./formatSkillPromptContent";
export { buildSkillsReadyEvent } from "./buildSkillsReadyEvent";
export {
  CONTEXT_READY_VERBOSE_WARNING_CODES,
  CONTEXT_READY_WARNING_CODES,
  deriveContextFocusFromUnderstanding,
  scopeDiscoveredContextPaths,
} from "./contextFocus";
export {
  applyPlanModeDiscoveryContract,
  isAgentWidePlanningScope,
} from "./planDiscoveryContract";
export {
  clarifyAfterInsufficientPlanDiscovery,
  isPlanDiscoveryEvidenceSufficient,
  isThoroughPlanDiscoveryEvidenceSufficient,
  requiresPlanDiscoveryQualityFloor,
  shouldPreferDiscoverySymbolEvidence,
  shouldRequireDiscoverySymbolEvidence,
  usesThoroughPlanDiscoveryEvidence,
} from "./planDiscoveryQuality";
export type { PlanningDepthForQuality } from "./planDiscoveryQuality";
export {
  buildPlanningQuery,
  buildScopedRepoMapForPlanning,
  collectPreferredPlanningPaths,
  extractPriorPathHints,
  inferDiscoveryTargetKind,
  inferLanguageFromPaths,
  isPlanningFollowUp,
  isSafeRelativePlanningPath,
  normalizePlanningPath,
  toPlanningBuildEvidence,
  uniqueStrings,
} from "./planningContext";
export {
  apiBackendDiscoveryProfile,
  authDiscoveryProfile,
  browserTestRunnerDiscoveryProfile,
  buildConfigDiscoveryProfile,
  cappedGlobPatterns,
  cappedSearchQueries,
  ciCdDiscoveryProfile,
  collectShapedDiscoveryHits,
  createShapedDiscoveryProfile,
  databaseDiscoveryProfile,
  extractGlobPathsFromToolOutput,
  extractSearchPathsFromToolOutput,
  frontendComponentDiscoveryProfile,
  matchesBrowserTestRunnerQuery,
  monorepoDiscoveryProfile,
  hasExplicitFilePathTargets,
  isExplicitFilePathTarget,
  rankPathsForShapedDiscovery,
  resolveShapedDiscoveryProfile,
  securityDiscoveryProfile,
  selectShapedDiscoverySeeds,
  SHAPED_DISCOVERY_PROFILES,
  testingDiscoveryProfile,
} from "./shapedDiscovery";
export type { CreateShapedDiscoveryProfileInput, PathScoreRule, ShapedDiscoveryProfile } from "./shapedDiscovery";
export {
  buildDiagnosticSummary,
  buildPreflightVerificationInput,
  buildSyntheticPreflightGrant,
  derivePreflightTargets,
  extractMentionedPaths,
  resolvePreflightChangeScope,
  resolveVerificationProjects,
  uniqueVerificationEvidence,
} from "./preflightBuild";
export { collectUnderstandingCandidatePaths } from "./collectUnderstandingCandidatePaths";
export {
  isExplicitEditorReference,
  isFileContextRelevant,
  isInternalAgentPath,
  scoreFileContextRelevance,
} from "./isFileContextRelevant";
export {
  allowsTargetedDiscoveryAfterRejectedMutation,
  buildRejectedMutationRecoveryMessage,
  buildRejectedToolRecoveryMessage,
  isTargetedDiscoveryAfterRejectedMutation,
} from "./rejectedToolRecovery";
export {
  createInitialRunEvidence,
  finalizeRunEvidence,
  isSuccessfulVerificationToolResult,
  recordBuildStateDeltaEvidence,
  recordDiscoveryEvidence,
  recordPlanEvidence,
  markPlanEvidenceStepsDone,
  recordStopEvidence,
  recordToolEvidence,
  recordVerificationEvidence,
} from "./runEvidence";
export {
  resolveLoopTurnOutcome,
  isUnfulfilledExecute,
  isSyntheticCompletedEditsFallback,
  isPrematurePartialExecuteStop,
  grantAllowsWorkspaceFileMutation,
  WORKSPACE_FILE_MUTATION_TOOL_IDS,
  requiresMutationForExecute,
  buildUnfulfilledExecuteRecoveryMessage,
} from "./resolveLoopTurnOutcome";
export { isClearMutationBlocker } from "./isClearMutationBlocker";
export {
  shouldContinueVerificationRepair,
  maxVerificationRepairsForDepth,
  nextStalledRepairCount,
  reservedVerificationRepairModelCalls,
} from "./shouldContinueVerificationRepair";
export type {
  ShouldContinueVerificationRepairInput,
  VerificationRepairStopReason,
} from "./shouldContinueVerificationRepair";
export type {
  ResolveLoopTurnOutcome,
  ResolveLoopTurnOutcomeInput,
  LoopTurnDisposition,
} from "./resolveLoopTurnOutcome";

/** v8-owned modules (Phase 9+) — re-exported for pipeline + goldens. */
export {
  ToolLoopGuard,
  buildToolLoopCallSignature,
  buildToolLoopResultSignature,
  softToolLoopNudgeMessage,
  forceFinalToolLoopMessage,
} from "../modules/tool-loop-guard";
export type {
  ToolLoopCall,
  ToolLoopResult,
  ToolLoopCallDecision,
  ToolLoopResultDecision,
  ToolLoopGuardOptions,
} from "../modules/tool-loop-guard";
export {
  decideTruncationRecovery,
  truncationWarningMessage,
} from "../modules/truncation";
export type {
  TruncationRecoveryKind,
  TruncationRecoveryDecision,
} from "../modules/truncation";
export { discardIncompleteToolCalls } from "../modules/complete-tool-calls";
export {
  requiresMutation,
  batchIncludesMutatingTool,
  batchIsReadonlyTools,
  hasPlanDraftedThisRun,
  resolveReadonlyTurnsBeforeMutationNudge,
  shouldEscalateReadonlyThrashToContinue,
  softMutationNudgeMessage,
  readonlyThrashPartialAnswer,
  unfulfilledExecuteNudgeMessage,
} from "../modules/mutation-nudge";
export {
  resolveMutateReadinessBudget,
  resolveStepReadonlyTurnsBeforeGate,
  evaluateActiveStepMutateReadiness,
  shouldDemandEvidenceBeforePatch,
  buildStepEvidenceGateMessage,
  buildStepPatchRequiredMessage,
  filterToolsForMutateLock,
  mutateLockModelRequestFields,
  resolveMutateLockAllowTargetedReads,
  isMutateLockAllowedToolName,
  shouldRearmMutateLockOnContinue,
} from "../modules/mutate-readiness";
export type {
  MutateReadinessBudget,
  MutateReadinessTaskSize,
  ActiveStepMutateReadiness,
} from "../modules/mutate-readiness";
export { runV8MutationCritic } from "../modules/mutation-critic";
export type { V8MutationCriticDecision } from "../modules/mutation-critic";
