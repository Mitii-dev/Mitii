import type { TurnLoopSketch } from "../../flow/steps/10-TurnLoop";
import type { ToolInvocationRecord } from "../../helpers/tool-journal";

/** Derive usage + tool sketches from the turn-loop slice for RuntimeRunResult. */
export function buildRuntimeUsageSketch(turnLoop: TurnLoopSketch | undefined): {
  usage: {
    modelCalls: number;
    toolCalls: number;
    loopIterations: number;
    heartbeats: number;
    inputTokens?: number;
    outputTokens?: number;
    cacheHitTokens?: number;
    cacheMissTokens?: number;
  };
  toolInvocations: Array<{
    invocationId: string;
    toolId: string;
    status: "succeeded" | "failed" | "pending";
    summary?: string;
    reasonCode?: string;
    outputPreview?: string;
    exitCode?: number;
  }>;
} {
  const journal: ToolInvocationRecord[] = turnLoop?.journal ?? [];
  const summaries = new Map(
    (turnLoop?.toolSummaries ?? []).map((row) => [row.invocationId, row]),
  );
  const toolInvocations = journal.map((row) => {
    const meta = summaries.get(row.invocationId);
    return {
      invocationId: row.invocationId,
      toolId: row.toolId,
      status: mapToolStatus(row.status),
      ...(meta?.summary ? { summary: meta.summary } : {}),
      ...(meta?.reasonCode ? { reasonCode: meta.reasonCode } : {}),
      ...(meta?.outputPreview ? { outputPreview: meta.outputPreview } : {}),
      ...(typeof meta?.exitCode === "number" ? { exitCode: meta.exitCode } : {}),
    };
  });

  const usedModel =
    (turnLoop?.modelCallCount ?? 0) > 0 ||
    (turnLoop?.reasonCodes.some(
      (code) =>
        code.includes("runtime_model") || code.includes("scripted"),
    ) ??
      false);

  const modelCalls =
    typeof turnLoop?.modelCallCount === "number"
      ? turnLoop.modelCallCount
      : usedModel
        ? 1
        : 0;

  const loopIterations =
    typeof turnLoop?.loopIterations === "number"
      ? turnLoop.loopIterations
      : turnLoop
        ? 1
        : 0;

  const totals = turnLoop?.usageTotals;

  return {
    usage: {
      modelCalls,
      toolCalls: toolInvocations.length,
      loopIterations,
      heartbeats: turnLoop?.heartbeats ?? 0,
      ...(typeof totals?.inputTokens === "number"
        ? { inputTokens: totals.inputTokens }
        : {}),
      ...(typeof totals?.outputTokens === "number"
        ? { outputTokens: totals.outputTokens }
        : {}),
      ...(typeof totals?.cacheHitTokens === "number"
        ? { cacheHitTokens: totals.cacheHitTokens }
        : {}),
      ...(typeof totals?.cacheMissTokens === "number"
        ? { cacheMissTokens: totals.cacheMissTokens }
        : {}),
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
