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
  ToolLoopGuard,
  buildToolLoopCallSignature,
  buildToolLoopResultSignature,
  softToolLoopNudgeMessage,
  forceFinalToolLoopMessage,
  decideTruncationRecovery,
  truncationWarningMessage,
  isCompleteToolCall,
  discardIncompleteToolCalls,
  runV8MutationCritic,
  filterToolDefinitions,
  toToolIndexDefinition,
  TOOL_INDEX_INPUT_SCHEMA,
  DESCRIBE_TOOL_NAME,
  FULL_SCHEMA_TOOL_IDS,
  resolveShapedDiscoveryProfile,
  SHAPED_DISCOVERY_PROFILES,
} from "./actions";
export type {
  ToolLoopCall,
  ToolLoopResult,
  ToolLoopCallDecision,
  ToolLoopResultDecision,
  ToolLoopGuardOptions,
  TruncationRecoveryKind,
  TruncationRecoveryDecision,
  V8MutationCriticDecision,
  ShapedDiscoveryProfile,
} from "./actions";

export { V8EnginePipeline } from "./pipeline/V8EnginePipeline";
export type { V8EnginePipelineDependencies } from "./pipeline/V8EnginePipeline";

export { composeV8Engine } from "./adapters";
export type { ComposeV8EngineOptions } from "./adapters";
export {
  composeAgentEngine,
  parseV8EngineImplementation,
  isMitiiAgentEngine,
  compareEngineImplementations,
} from "./adapters";
export type {
  ComposeAgentEngineOptions,
  ComposedAgentEngine,
  MitiiAgentEngine,
  CompareEngineImplementationsResult,
  EngineComparePair,
} from "./adapters";
