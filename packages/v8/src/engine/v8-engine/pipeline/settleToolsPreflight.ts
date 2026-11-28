/**
 * Preflight failures before executing a tool batch (grant / tools / workspace).
 */
import type { ExecutionDecision } from "../../../modules/decision-policy";
import type { ModelToolCall } from "../../../modules/model-gateway";

import type { ToolLoopOutcome } from "./types";
import type { AgentEngineRuntime } from "./runtime";

export function settleToolsPreflightFailure(params: {
  needsWorkspaceTools: boolean;
  grant: ExecutionDecision["toolGrant"];
  runtime: AgentEngineRuntime;
  workspaceRoot: string | undefined;
  answer: string;
}): Extract<ToolLoopOutcome, { kind: "failed" }> | undefined {
  const { needsWorkspaceTools, grant, runtime, workspaceRoot, answer } = params;
  if (!needsWorkspaceTools) {
    return undefined;
  }
  if (grant.allowedTools.length === 0) {
    return {
      kind: "failed",
      answer: answer || undefined,
      extraReasons: ["misconfigured"],
      error: {
        code: "tool_calls_without_grant",
        message:
          "Model requested workspace tools on a route where no tools were granted.",
      },
    };
  }
  if (!runtime.deps.tools) {
    return {
      kind: "failed",
      answer: answer || undefined,
      extraReasons: ["misconfigured"],
      error: {
        code: "misconfigured",
        message: "Model requested tools but Tool Runtime is not configured.",
      },
    };
  }
  if (!workspaceRoot) {
    return {
      kind: "failed",
      answer: answer || undefined,
      extraReasons: ["misconfigured"],
      error: {
        code: "misconfigured",
        message: "Model requested tools but workspaceRoot was not provided.",
      },
    };
  }
  return undefined;
}

export function batchNeedsWorkspaceTools(
  toolCalls: readonly ModelToolCall[],
): boolean {
  return toolCalls.some((call) => call.name !== "update_todos");
}
