import type { AgentRunResult, RunEvent } from "../../../engine/v8-engine/contracts";
import type { RuntimeRunResult } from "../../contracts/output/RuntimeRunResult";

export type RuntimeBridgeSkipPhase =
  | "decided"
  | "context_ready"
  | "prompt_ready"
  | "verifying";

/** Build a host-facing RunEvent sequence from a finished RuntimeRunResult. */
export function buildRuntimeBridgeEvents(params: {
  runtime: RuntimeRunResult;
  result: AgentRunResult;
  at: string;
  /** Phases already streamed live during the pump. */
  skipPhases?: RuntimeBridgeSkipPhase[];
}): RunEvent[] {
  const { runtime, result, at } = params;
  const skip = new Set(params.skipPhases ?? []);
  const runId = runtime.runId;
  const events: RunEvent[] = [];

  if (!skip.has("decided")) {
    events.push(
      {
        type: "stage_started",
        runId,
        stage: "decided",
        at,
      },
      {
        type: "decision_made",
        runId,
        route: result.route ?? "direct_answer",
        runDisposition:
          result.status === "suspended" &&
          result.suspension?.kind === "clarification_required"
            ? "clarification_required"
            : "continue",
        at,
      },
      {
        type: "stage_completed",
        runId,
        stage: "decided",
        at,
      },
    );
  }

  if (runtime.mcpServerIds && runtime.mcpServerIds.length > 0) {
    events.push({
      type: "warning",
      runId,
      message: `MCP attached: ${runtime.mcpServerIds.join(",")}`,
      code: "mcp_attach",
      data: { count: runtime.mcpServerIds.length },
      at,
    });
  }

  if (runtime.context && !skip.has("context_ready")) {
    events.push({
      type: "context_ready",
      runId,
      stateToken: `ctx:${runId}`,
      blockCount: runtime.context.blockCount,
      retrievedCandidates: runtime.context.focusPathCount,
      selectedItems: runtime.context.focusPathCount,
      droppedBlocks: 0,
      status: "ready",
      at,
    });
  }

  if (runtime.prompt && !skip.has("prompt_ready")) {
    events.push({
      type: "prompt_ready",
      runId,
      status: runtime.prompt.status,
      totalOmittedTokens: 0,
      totalTruncatedTokens: 0,
      at,
    });
  }

  if (runtime.grantProfile) {
    const effect =
      runtime.grantProfile === "agent_execute"
        ? "write"
        : runtime.grantProfile === "research" ||
            runtime.grantProfile === "readonly"
          ? "read"
          : "none";
    const approval =
      runtime.grantProfile === "agent_execute" ? "every_mutation" : "never";
    events.push({
      type: "grant_narrowed",
      runId,
      maximumWorkspaceEffect: effect,
      approvalMode: approval,
      pathScopes: [],
      reasonCodes: [`grant_${runtime.grantProfile}`],
      at,
    });
  }

  for (const tool of runtime.toolInvocations ?? []) {
    events.push({
      type: "tool_started",
      runId,
      callId: tool.invocationId,
      toolName: tool.toolId,
      at,
    });
    events.push({
      type: "tool_completed",
      runId,
      callId: tool.invocationId,
      toolName: tool.toolId,
      status: tool.status,
      at,
    });
  }

  const heartbeats = runtime.usage?.heartbeats ?? 0;
  if (heartbeats > 0) {
    events.push({
      type: "warning",
      runId,
      message: `Runtime heartbeat x${heartbeats}`,
      code: "heartbeat",
      data: { count: heartbeats },
      at,
    });
  }

  const answer = runtime.answer?.trim();
  if (answer && result.status === "completed") {
    events.push({
      type: "model_delta",
      runId,
      kind: "content",
      preview: answer.slice(0, 500),
      at,
    });
    events.push({
      type: "model_turn",
      runId,
      turnIndex: 0,
      finishReason: "stop",
      at,
    });
  }

  if (runtime.memoryCommit?.committed) {
    events.push({
      type: "memory_ready",
      runId,
      selectedCount: runtime.memoryCommit.factCount,
      omittedCount: 0,
      status: "committed",
      at,
    });
  }

  const verify = runtime.verify;
  if (verify?.ranVerify) {
    if (!skip.has("verifying")) {
      events.push({
        type: "stage_started",
        runId,
        stage: "verifying",
        at,
      });
    }
    events.push({
      type: "verification_completed",
      runId,
      status: verify.invalidated
        ? "implemented_unverified"
        : "verified_success",
      reasonCodes: verify.invalidated
        ? ["stale_state_risk"]
        : ["checks_passed"],
      checks: [],
      diagnostics: [],
      warnings: verify.invalidated
        ? ["verify_invalidated_after_mutate"]
        : [],
      at,
    });
    events.push({
      type: "stage_completed",
      runId,
      stage: "verifying",
      at,
    });
    if (verify.invalidated) {
      events.push({
        type: "warning",
        runId,
        message: "Verify fingerprint changed after mutate journal advanced",
        code: "verify_invalidated_after_mutate",
        stage: "verifying",
        at,
      });
    }
  }

  if (runtime.planFresh === false) {
    events.push({
      type: "warning",
      runId,
      message: "Approved plan fingerprint does not match Store",
      code: "plan_stale",
      at,
    });
  }

  if (runtime.handoff) {
    events.push({
      type: "warning",
      runId,
      message: runtime.handoff.reason,
      code: "task_handoff",
      data: {
        ...(runtime.handoff.fromTaskId
          ? { fromTaskId: runtime.handoff.fromTaskId }
          : {}),
        ...(runtime.handoff.toTaskId
          ? { toTaskId: runtime.handoff.toTaskId }
          : {}),
      },
      at,
    });
  }

  if (result.status === "suspended" && result.suspension) {
    events.push({
      type: "suspended",
      runId,
      kind: result.suspension.kind,
      rationale: result.suspension.rationale,
      at,
    });
  }

  events.push({
    type: "terminal",
    runId,
    status: result.status,
    result,
    at,
  });

  return events;
}
