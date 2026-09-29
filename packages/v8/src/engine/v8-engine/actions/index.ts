export {
  shouldForcePreflightRepairLock,
  preflightErrorsMatchUserRequest,
  preflightDiagnosticsForUserRequest,
} from "./userPathPriority";

export {
  ToolLoopGuard,
  buildToolLoopCallSignature,
  buildToolLoopResultSignature,
  softToolLoopNudgeMessage,
  forceFinalToolLoopMessage,
} from "./toolLoopGuard";
export type {
  ToolLoopCall,
  ToolLoopResult,
  ToolLoopCallDecision,
  ToolLoopResultDecision,
  ToolLoopGuardOptions,
} from "./toolLoopGuard";

export {
  decideTruncationRecovery,
  truncationWarningMessage,
} from "./truncationRecovery";
export type {
  TruncationRecoveryKind,
  TruncationRecoveryDecision,
} from "./truncationRecovery";

export {
  isCompleteToolCall,
  discardIncompleteToolCalls,
} from "./completeToolCalls";

export {
  requiresMutation,
  batchIncludesMutatingTool,
  batchIsReadonlyTools,
  softMutationNudgeMessage,
  unfulfilledExecuteNudgeMessage,
} from "./mutationNudge";

export { runV8MutationCritic } from "./mutationCritic";
export type { V8MutationCriticDecision } from "./mutationCritic";

export {
  DESCRIBE_TOOL_NAME,
  FULL_SCHEMA_TOOL_IDS,
  TOOL_INDEX_INPUT_SCHEMA,
  filterToolDefinitions,
  toToolIndexDefinition,
} from "./progressiveTools";

export {
  SHAPED_DISCOVERY_PROFILES,
  resolveShapedDiscoveryProfile,
} from "./shapedDiscovery";
export type { ShapedDiscoveryProfile } from "./shapedDiscovery";
