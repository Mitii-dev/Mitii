import type { EventBus } from "../internal/EventBus";
import { logVerbosityAtLeast } from "../internal/logVerbosity";
import type { AgentEngineStartInput } from "../contracts";
import type { AgentEngineRuntime } from "./runtime";

/** Surface window-policy reductions of requested run-budget ceilings. */
export function emitRunBudgetClampWarnings(
  runtime: AgentEngineRuntime,
  params: {
    runId: string;
    bus: EventBus;
    clamped: ReadonlyArray<{
      field: string;
      requested: number;
      effective: number;
    }>;
    logVerbosity: AgentEngineStartInput["logVerbosity"];
  },
): void {
  if (
    params.clamped.length === 0 ||
    !logVerbosityAtLeast(params.logVerbosity, "standard")
  ) {
    return;
  }
  for (const field of params.clamped) {
    runtime.emit(params.bus, {
      type: "warning",
      runId: params.runId,
      message: `Run budget "${field.field}" reduced from ${field.requested} to ${field.effective} by the window policy.`,
      code: "run_budget_clamped",
      data: {
        field: field.field,
        requested: field.requested,
        effective: field.effective,
      },
      at: runtime.isoNow(),
    });
  }
}
