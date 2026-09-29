export {
  V8_ENGINE_SCHEMA_VERSION,
  V8_ENGINE_IMPLEMENTATIONS,
  V8_ENGINE_REASON_CODES,
} from "./constants";
export type {
  V8EngineImplementation,
  V8EngineReasonCode,
} from "./constants";

export {
  V8_ENGINE_PROMOTION,
  defaultV8EngineImplementation,
  isKnownV8EngineImplementation,
} from "./promotion";
export type { V8EnginePromotion } from "./promotion";

export {
  V8_ENGINE_THRESHOLDS,
  V8_ENGINE_DROPPED_LEGACY_KEYS,
  resolveV8EngineThresholds,
  v8EngineThresholdsSchema,
  v8EngineThresholdsOverridesSchema,
} from "./policy";
export type {
  V8EngineThresholds,
  V8EngineThresholdsOverrides,
} from "./policy";

export {
  V8_ENGINE_BANDS,
  V8_ENGINE_BAND_CEILINGS,
  V8_ENGINE_BAND_TABLE,
  resolveV8EngineBand,
  v8EngineBandDefinition,
  listV8EngineBands,
  resolveV8LoopPolicyThresholds,
} from "./policy/bands";
export type {
  V8EngineBand,
  V8EngineBandDefinition,
  ResolveV8LoopPolicyInput,
  ResolvedV8LoopPolicy,
} from "./policy/bands";

export {
  agentEngineStartInputSchema,
  agentEngineResumeInputSchema,
  agentEngineRestoreInputSchema,
  agentRunBudgetSchema,
  agentRunResultSchema,
  runEventSchema,
  runEvidenceSchema,
  AgentEngineError,
} from "./contracts";
export type {
  AgentEngineStartInput,
  AgentEngineResumeInput,
  AgentEngineRestoreInput,
  AgentEngineRestoreResult,
  AgentEngineDependencies,
  AgentRunBudget,
  AgentRunHandle,
  AgentRunResult,
  RunEvent,
  RunEvidence,
  RestorePoint,
  RestorePointSummary,
} from "./contracts";

export {
  shouldForcePreflightRepairLock,
  preflightErrorsMatchUserRequest,
  preflightDiagnosticsForUserRequest,
} from "./modules/user-path-priority";
export {
  ToolLoopGuard,
  buildToolLoopCallSignature,
  buildToolLoopResultSignature,
  softToolLoopNudgeMessage,
  forceFinalToolLoopMessage,
} from "./modules/tool-loop-guard";
export type {
  ToolLoopCall,
  ToolLoopResult,
  ToolLoopCallDecision,
  ToolLoopResultDecision,
  ToolLoopGuardOptions,
} from "./modules/tool-loop-guard";
export {
  decideTruncationRecovery,
  truncationWarningMessage,
} from "./modules/truncation";
export type {
  TruncationRecoveryKind,
  TruncationRecoveryDecision,
} from "./modules/truncation";
export {
  isCompleteToolCall,
  discardIncompleteToolCalls,
} from "./modules/complete-tool-calls";
export { runV8MutationCritic } from "./modules/mutation-critic";
export type { V8MutationCriticDecision } from "./modules/mutation-critic";
export {
  filterToolDefinitions,
  toToolIndexDefinition,
  TOOL_INDEX_INPUT_SCHEMA,
  DESCRIBE_TOOL_NAME,
  FULL_SCHEMA_TOOL_IDS,
} from "./modules/progressive-tools";
export {
  resolveShapedDiscoveryProfile,
  SHAPED_DISCOVERY_PROFILES,
} from "./modules/shaped-discovery";
export type { ShapedDiscoveryProfile } from "./modules/shaped-discovery";

export {
  EventBus,
  RunBudgetTracker,
  ToolCallCache,
  rebaseToolResult,
  ReadLedger,
  buildAlreadyReadToolResult,
} from "./internal";
export type {
  ReadLedgerEntry,
  AgentRunCheckpoint,
  AgentEngineRunCheckpointStorePort,
  PendingApprovalState,
  PendingGrantExpansionState,
} from "./internal";

export { V8EnginePipeline } from "./pipeline/V8EnginePipeline";
export type { V8EnginePipelineDependencies } from "./pipeline/V8EnginePipeline";
/** @deprecated Phase 10 — alias for V8EnginePipeline. */
export { V8EnginePipeline as AgentEnginePipeline } from "./pipeline/V8EnginePipeline";
export type { V8EnginePipelineDependencies as AgentEnginePipelineDependencies } from "./pipeline/V8EnginePipeline";

export {
  CONTEXT_EPOCH_SOURCE_KEYS,
  MID_CONVERSATION_SYSTEM_MARKERS,
  InMemoryContextEpochStore,
  admitContextEpoch,
  appendMidConversationSystemMessage,
  baselinePrefixMatches,
  buildContextEpochSnapshot,
  extractBaselineSystemText,
  hashContextText,
  initializeContextEpoch,
  isMidConversationSystemContent,
  markContextEpochForReplacement,
  normalizeContextEpochSnapshot,
  observedIdsFromContextEpoch,
  pinBaselineSystemMessage,
  reconcileContextEpoch,
  replaceContextEpoch,
  stripMidConversationSystemMessages,
  wrapMidConversationSystemText,
} from "./internal/context-epoch";
export type {
  AdmitContextEpochInput,
  ContextEpoch,
  ContextEpochAdmitResult,
  ContextEpochReconcileResult,
  ContextEpochSnapshot,
  ContextEpochStorePort,
} from "./internal/context-epoch";

export {
  SYSTEM_CONTEXT_SOURCE_KEYS,
  SYSTEM_CONTEXT_UNAVAILABLE,
  assertSystemContextKey,
  combineSystemContexts,
  composeMitiiSystemContext,
  emptySystemContext,
  encodeJson,
  initializeSystemContext,
  makeSystemContextSource,
  reconcileSystemContext,
  replaceSystemContext,
} from "./internal/system-context";
export type {
  ObservedContextSourceValues,
  SystemContext,
  SystemContextGeneration,
  SystemContextReconcileResult,
  SystemContextSnapshot,
  SystemContextSourceDefinition,
} from "./internal/system-context";

export {
  SESSION_HISTORY_POLICY,
  SESSION_HISTORY_PROJECTION_MARKERS,
  InMemorySessionHistoryArchive,
  looksReferentialSessionQuery,
  resolveSessionHistoryProjectionBudgetChars,
  retrieveSessionHistory,
  isSessionHistoryCheckpointContent,
} from "./internal/session-history";
export type {
  SessionHistoryArchivePort,
  SessionHistoryRecord,
  SessionHistoryRetrieveHit,
  SessionHistoryRetrieveResult,
} from "./internal/session-history";

export {
  AGENT_ENGINE_SCHEMA_VERSION,
  AGENT_LOG_VERBOSITIES,
  DEFAULT_AGENT_LOG_VERBOSITY,
  AGENT_ENGINE_THRESHOLDS,
  resolveAgentEngineThresholds,
  agentEngineThresholdsSchema,
  agentEngineThresholdsOverridesSchema,
  resolveLoopPolicyThresholds,
  resolveLoopPolicyBandThresholds,
  LOOP_POLICY_WINDOW_BANDS,
  LOOP_POLICY_WINDOW_BAND_CEILINGS,
  LOOP_POLICY_WINDOW_BAND_TABLE,
  resolveLoopPolicyWindowBand,
  loopPolicyWindowBandDefinition,
  listLoopPolicyWindowBands,
  POLICY_LAB_SCHEMA_VERSION,
  policyLabFileSchema,
  EMPTY_POLICY_LAB,
  parsePolicyLabFile,
  tryParsePolicyLabFile,
  resolvePolicyLabOverrides,
  mergeLabUnderHostOverrides,
  promotePolicyLabToShip,
  labLoopDeltas,
  labWindowDeltas,
  DEFAULT_TOOL_DEFINITIONS,
} from "./legacy";
export type {
  AgentLogVerbosity,
  AgentEngineThresholds,
  AgentEngineThresholdsOverrides,
  LoopPolicyWindowBand,
  LoopPolicyWindowBandDefinition,
  ResolveLoopPolicyThresholdsInput,
  ResolvedLoopPolicy,
  PolicyLabFile,
  ResolvePolicyLabOverridesInput,
  ResolvedPolicyLabOverrides,
  PromotePolicyLabInput,
  PromotePolicyLabResult,
} from "./legacy";

export {
  agentEngineRestoreResultSchema,
  restorePointSchema,
  restorePointSummarySchema,
  agentRunStatusSchema,
  agentRunSuspensionSchema,
  agentRunUsageSchema,
  agentReasonCodeSchema,
  agentSuspensionKindSchema,
  agentActiveStageSchema,
  agentEventTypeSchema,
  agentEngineErrorCodeSchema,
} from "./contracts";
export type {
  AgentRunStatus,
  AgentRunSuspension,
  AgentRunUsage,
  AgentSuspensionKind,
  AgentActiveStage,
  AgentEngineErrorCode,
  AgentEngineClockPort,
  AgentEngineIdGeneratorPort,
  AgentEngineIntakePort,
  AgentEngineUnderstandingPort,
  AgentEngineDecisionPort,
  AgentEnginePromptPort,
  AgentEngineSkillsPort,
  AgentEngineMemoryPort,
  AgentEnginePlanningPort,
  AgentEngineRepositoryStatePort,
  AgentEngineRepositoryContextPort,
  AgentEngineToolRuntimePort,
  AgentEngineVerificationPort,
  AgentEngineReviewPort,
  RunEvidenceIssue,
} from "./contracts";

export { composeV8Engine } from "./adapters";
export type { ComposeV8EngineOptions } from "./adapters";
export {
  composeAgentEngine,
  composeReadOnlyAgentEngine,
  parseV8EngineImplementation,
  isMitiiAgentEngine,
  compareEngineImplementations,
  InMemoryRunCheckpointStore,
  FileRunCheckpointStore,
} from "./adapters";
export type {
  ComposeAgentEngineOptions,
  ComposeReadOnlyAgentEngineOptions,
  ComposedAgentEngine,
  MitiiAgentEngine,
  CompareEngineImplementationsResult,
  EngineComparePair,
} from "./adapters";
