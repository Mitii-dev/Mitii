/**
 * On mutation-approve resume: execute the pending tool and stamp the hydrate
 * snapshot so the turn loop continues from saved messages (no rediscovery).
 */

import type { StoreSnapshot } from "../store/StoreSnapshot";
import type { RuntimeToolExecutorPort } from "../../ports/RuntimeToolExecutorPort";
import type { GrantSurface } from "../../tools/CheckToolAgainstGrant";
import type { RuntimeModelMessage } from "../../ports/RuntimeModelPort";
import { formatToolMessageContent } from "./TurnLoopToolEventHelpers";

type PendingMutation = {
  toolId?: string;
  invocationId?: string;
  args?: unknown;
};

export async function settleApprovedMutationOnResume(input: {
  snapshot: StoreSnapshot | undefined;
  checkpointPayload?: Record<string, unknown>;
  tools?: RuntimeToolExecutorPort;
}): Promise<{
  snapshot: StoreSnapshot | undefined;
  reasonCodes: string[];
  settled: boolean;
  /** True when messages were restored for turn-loop continue. */
  canContinueLoop: boolean;
  toolId?: string;
  summary?: string;
}> {
  const reasonCodes: string[] = [];
  const pending = resolvePending(input.snapshot, input.checkpointPayload);
  if (!pending?.toolId || !pending.invocationId) {
    return {
      snapshot: input.snapshot,
      reasonCodes: ["resume_mutation_missing_pending"],
      settled: false,
      canContinueLoop: false,
    };
  }
  if (!input.tools) {
    return {
      snapshot: input.snapshot,
      reasonCodes: ["resume_mutation_missing_tools"],
      settled: false,
      canContinueLoop: false,
    };
  }

  const grant = grantForApprovedSettle(input.snapshot?.slices.decision);

  const executed = await input.tools.execute({
    toolId: pending.toolId,
    args: pending.args ?? {},
    grant,
    invocationId: pending.invocationId,
  });

  reasonCodes.push(
    executed.ok
      ? "resume_mutation_tool_settled"
      : "resume_mutation_tool_failed",
  );

  const toolContent = formatToolMessageContent(executed.output, {
    ok: executed.ok,
    reason: executed.reasonCode,
    status: executed.ok ? "succeeded" : "failed",
  });

  const priorMessages = Array.isArray(input.snapshot?.slices.turnLoopMessages)
    ? (input.snapshot!.slices.turnLoopMessages as RuntimeModelMessage[])
    : [];
  const messages = patchPendingToolMessage(
    priorMessages,
    pending.invocationId,
    toolContent,
  );

  const nextSlices: Record<string, unknown> = {
    ...(input.snapshot?.slices ?? {}),
    pendingMutationApproval: undefined,
    mutationSettledOnResume: true,
    turnLoopMessages: messages,
  };

  const snapshot: StoreSnapshot | undefined = input.snapshot
    ? {
        ...input.snapshot,
        slices: nextSlices,
        capturedAt: new Date().toISOString(),
      }
    : undefined;

  return {
    snapshot,
    reasonCodes,
    settled: executed.ok,
    canContinueLoop: messages.length > 0 && executed.ok,
    toolId: pending.toolId,
    summary: summarizePending(pending),
  };
}

function resolvePending(
  snapshot: StoreSnapshot | undefined,
  payload?: Record<string, unknown>,
): PendingMutation | undefined {
  const fromSlice = snapshot?.slices.pendingMutationApproval as
    | PendingMutation
    | undefined;
  if (fromSlice?.toolId && fromSlice.invocationId) return fromSlice;
  if (!payload) return undefined;
  const toolId =
    typeof payload.toolId === "string"
      ? payload.toolId
      : typeof payload.toolName === "string"
        ? payload.toolName
        : undefined;
  const invocationId =
    typeof payload.invocationId === "string"
      ? payload.invocationId
      : typeof payload.callId === "string"
        ? payload.callId
        : typeof payload.approvalId === "string"
          ? payload.approvalId.replace(/^appr_/, "")
          : undefined;
  if (!toolId || !invocationId) return undefined;
  return {
    toolId,
    invocationId,
    args: payload.args,
  };
}

function patchPendingToolMessage(
  messages: RuntimeModelMessage[],
  invocationId: string,
  content: string,
): RuntimeModelMessage[] {
  let patched = false;
  const next = messages.map((m) => {
    if (m.role === "tool" && m.toolCallId === invocationId) {
      patched = true;
      return { ...m, content };
    }
    return m;
  });
  if (!patched) {
    next.push({
      role: "tool",
      toolCallId: invocationId,
      content,
    });
  }
  return next;
}

function summarizePending(pending: PendingMutation): string {
  return `${pending.toolId ?? "tool"} (${pending.invocationId ?? "?"})`;
}

/** Host already approved — write grant with approvalMode never for this settle. */
function grantForApprovedSettle(decision: unknown): GrantSurface {
  const compiled =
    decision &&
    typeof decision === "object" &&
    "toolGrant" in decision &&
    decision.toolGrant &&
    typeof decision.toolGrant === "object"
      ? (decision.toolGrant as {
          allowedTools?: string[];
          maximumWorkspaceEffect?: GrantSurface["maximumWorkspaceEffect"];
          allowedEffects?: string[];
          pathScopes?: string[];
          commandRules?: GrantSurface["commandRules"];
        })
      : undefined;
  if (compiled?.allowedTools && compiled.allowedTools.length > 0) {
    return {
      allowedTools: [...compiled.allowedTools],
      maximumWorkspaceEffect: compiled.maximumWorkspaceEffect ?? "write",
      allowedEffects: [
        ...(compiled.allowedEffects ?? ["workspace_write"]),
      ],
      approvalMode: "never",
      pathScopes: [...(compiled.pathScopes ?? [])],
      ...(compiled.commandRules?.length
        ? { commandRules: compiled.commandRules }
        : {}),
    };
  }
  return {
    allowedTools: [
      "apply_patch",
      "delete_file",
      "move_file",
      "run_command",
      "run_readonly_command",
    ],
    maximumWorkspaceEffect: "write",
    allowedEffects: ["workspace_write", "process_execute"],
    approvalMode: "never",
    pathScopes: [],
  };
}
