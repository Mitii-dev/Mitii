import type { PromptBudgetSketch } from "../store/PackTurn";
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
    /** Real PromptConstruction budget — required for host Context Usage bars. */
    promptBudget?: PromptBudgetSketch;
    promptStatus?: "complete" | "partial" | "blocked";
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
    const budget = params.promptBudget;
    sink.push({
      type: "prompt_ready",
      runId,
      status: params.promptStatus ?? "complete",
      totalOmittedTokens: budget?.totalOmittedTokens ?? 0,
      totalTruncatedTokens: budget?.totalTruncatedTokens ?? 0,
      ...(budget
        ? {
            budget: {
              contextWindowTokens: budget.contextWindowTokens,
              outputReservedTokens: budget.outputReservedTokens,
              inputBudgetTokens: budget.inputBudgetTokens,
              totalUsedTokens: budget.totalUsedTokens,
              withinLimits: budget.withinLimits,
              sections: budget.sections.slice(0, 16).map((section) => ({
                section: section.section,
                allocatedTokens: section.allocatedTokens,
                usedTokens: section.usedTokens,
                omittedTokens: section.omittedTokens,
                truncatedTokens: section.truncatedTokens,
              })),
            },
            window: {
              toolSchemaTokens:
                budget.sections.find((s) => s.section === "tools")
                  ?.allocatedTokens ?? 0,
              usableInputTokens: budget.inputBudgetTokens,
              repositoryTokens:
                budget.sections.find((s) => s.section === "repository")
                  ?.allocatedTokens ?? 0,
              conversationTokens:
                budget.sections.find((s) => s.section === "conversation")
                  ?.allocatedTokens ?? 0,
              planTokens:
                budget.sections.find((s) => s.section === "plan")
                  ?.allocatedTokens ?? 0,
              planUsedTokens:
                budget.sections.find((s) => s.section === "plan")?.usedTokens ??
                0,
              skillsTokens:
                budget.sections.find((s) => s.section === "skills")
                  ?.allocatedTokens ?? 0,
              systemTokens:
                (budget.sections.find((s) => s.section === "system")
                  ?.allocatedTokens ?? 0) +
                (budget.sections.find((s) => s.section === "rules")
                  ?.allocatedTokens ?? 0) +
                (budget.sections.find((s) => s.section === "memory")
                  ?.allocatedTokens ?? 0),
            },
          }
        : {}),
      at,
    });
    return;
  }

  if (phase === "verifying") {
    sink.push({ type: "stage_started", runId, stage: "verifying", at });
  }
}
