/**
 * Shim — owner is runtime/helpers/loop-rails/tool-loop-guard.
 */
export {
  ToolLoopGuard,
  softToolLoopNudgeMessage,
  forceFinalToolLoopMessage,
  buildToolLoopCallSignature,
  buildToolLoopResultSignature,
  canonicalizeArgumentsForLoop,
} from "../../../../runtime/helpers/loop-rails/tool-loop-guard/ToolLoopGuard";
export type {
  ToolLoopCall,
  ToolLoopResult,
  ToolLoopCallDecision,
  ToolLoopResultDecision,
  ToolLoopGuardOptions,
} from "../../../../runtime/helpers/loop-rails/tool-loop-guard/ToolLoopGuard";
