import type { TurnLoopSketch } from "../../flow/steps/10-TurnLoop";
import type { ToolInvocationRecord } from "../../helpers/tool-journal";

/** Derive usage + tool sketches from the turn-loop slice for RuntimeRunResult. */
export function buildRuntimeUsageSketch(turnLoop: TurnLoopSketch | undefined): {
  usage: {
    modelCalls: number;
    toolCalls: number;
    loopIterations: number;
    heartbeats: number;
  };
  toolInvocations: Array<{
    invocationId: string;
    toolId: string;
    status: "succeeded" | "failed" | "pending";
  }>;
} {
  const journal: ToolInvocationRecord[] = turnLoop?.journal ?? [];
  const toolInvocations = journal.map((row) => ({
    invocationId: row.invocationId,
    toolId: row.toolId,
    status: mapToolStatus(row.status),
  }));

  const usedModel =
    turnLoop?.reasonCodes.some(
      (code) =>
        code.includes("turn_loop_with_ports") ||
        code.includes("runtime_model") ||
        code.includes("scripted"),
    ) ?? false;

  return {
    usage: {
      modelCalls: usedModel ? 1 : 0,
      toolCalls: toolInvocations.length,
      loopIterations: turnLoop ? 1 : 0,
      heartbeats: turnLoop?.heartbeats ?? 0,
    },
    toolInvocations,
  };
}

function mapToolStatus(
  status: ToolInvocationRecord["status"],
): "succeeded" | "failed" | "pending" {
  if (status === "succeeded") return "succeeded";
  if (status === "failed" || status === "cancelled") return "failed";
  return "pending";
}
