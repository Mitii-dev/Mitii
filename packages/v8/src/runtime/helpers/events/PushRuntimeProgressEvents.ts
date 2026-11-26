import type { RuntimeEventSink } from "./RuntimeEventChannel";

type ProgressRoute =
  | "clarify"
  | "diagnose"
  | "plan"
  | "execute"
  | "direct_answer"
  | "repository_answer";

function mapProgressRoute(route: string | undefined): ProgressRoute {
  if (
    route === "clarify" ||
    route === "diagnose" ||
    route === "plan" ||
    route === "execute" ||
    route === "direct_answer" ||
    route === "repository_answer"
  ) {
    return route;
  }
  if (route === "answer") return "repository_answer";
  return "direct_answer";
}

/** Emit early progress events while the runtime pump is still running. */
export function pushRuntimeProgressEvents(
  sink: RuntimeEventSink | undefined,
  params: {
    runId: string;
    at: string;
    phase:
      | "received"
      | "decided"
      | "context_ready"
      | "prompt_ready"
      | "verifying";
    route?: string;
  },
): void {
  if (!sink) return;
  const { runId, at, phase } = params;

  if (phase === "received") {
    sink.push({ type: "stage_started", runId, stage: "received", at });
    sink.push({ type: "stage_completed", runId, stage: "received", at });
    return;
  }

  if (phase === "decided") {
    sink.push({ type: "stage_started", runId, stage: "decided", at });
    sink.push({
      type: "decision_made",
      runId,
      route: mapProgressRoute(params.route),
      runDisposition: "continue",
      at,
    });
    sink.push({ type: "stage_completed", runId, stage: "decided", at });
    return;
  }

  if (phase === "context_ready") {
    sink.push({
      type: "context_ready",
      runId,
      stateToken: `ctx:${runId}`,
      blockCount: 1,
      retrievedCandidates: 0,
      selectedItems: 0,
      droppedBlocks: 0,
      status: "ready",
      at,
    });
    return;
  }

  if (phase === "prompt_ready") {
    sink.push({
      type: "prompt_ready",
      runId,
      status: "complete",
      totalOmittedTokens: 0,
      totalTruncatedTokens: 0,
      at,
    });
    return;
  }

  if (phase === "verifying") {
    sink.push({ type: "stage_started", runId, stage: "verifying", at });
  }
}
