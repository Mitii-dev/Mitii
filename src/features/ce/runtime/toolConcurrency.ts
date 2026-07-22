import { isReadOnlyCommand } from '../plans/PlanActEngine';
import { ToolId } from '../tools/toolIds';
import { isParallelSafeToolName } from '../tools/toolMetadata';

/**
 * Whether a single tool call is safe to run concurrently with other calls in the same round.
 * `run_command` is content-dependent — only commands `isReadOnlyCommand` already classifies
 * as read-only (the same check the approval gate and audit-mode restriction use) qualify.
 */
export function isParallelSafeToolCall(toolName: string, input: Record<string, unknown>): boolean {
  if (toolName === ToolId.RunCommand) {
    return isReadOnlyCommand(typeof input.command === 'string' ? input.command : '');
  }
  return isParallelSafeToolName(toolName);
}

/**
 * A round of tool calls is only run concurrently when every call in it is independently
 * safe — a single mutating/approval-gated/ordering-sensitive call anywhere in the round
 * falls the whole round back to strictly sequential execution.
 */
export function canParallelizeRound(
  calls: ReadonlyArray<{ name: string; input: Record<string, unknown> }>
): boolean {
  return calls.length > 1 && calls.every((call) => isParallelSafeToolCall(call.name, call.input));
}
