import {
  runThroughPlanPipeline,
  type RunThroughPlanPipelineResult,
} from "./RunThroughPlanPipeline";
import {
  enrichContext,
  enrichContextWithRetrieval,
  type ContextBundleSketch,
} from "./steps/9-EnrichContext";
import { turnLoopShell, type TurnLoopSketch } from "./steps/10-TurnLoop";
import { turnLoopWithPorts } from "./steps/10-TurnLoopWithPorts";
import type { RuntimeStartInput } from "../contracts/input/RuntimeStartInput";
import type { GrantSurface } from "../tools/CheckToolAgainstGrant";
import type { RuntimeDependencies } from "../ports/RuntimeDependencies";
import type { StoreSnapshot } from "../helpers/store/StoreSnapshot";
import { pushRuntimeProgressEvents } from "../helpers/events/PushRuntimeProgressEvents";
import type { RuntimeEventSink } from "../helpers/events/RuntimeEventChannel";
import type { RuntimeDecisionSketch } from "./steps/5-Decide";

export interface RunThroughTurnLoopResult extends RunThroughPlanPipelineResult {
  contextBundle?: ContextBundleSketch;
  turnLoop?: TurnLoopSketch;
}

/** Plan path then enrich + turn-loop (ports when deps.model set). */
export async function runThroughTurnLoop(input: {
  start: RuntimeStartInput;
  mode?: "ask" | "plan" | "agent";
  runId?: string;
  grant?: GrantSurface;
  deps?: RuntimeDependencies;
  hydrateSnapshot?: StoreSnapshot;
  abortSignal?: AbortSignal;
  /** Live sink — emit decided/context/prompt before the turn loop starts. */
  eventSink?: RuntimeEventSink;
  simulatedToolCalls?: Array<{
    toolId: string;
    args?: unknown;
    effect?: "none" | "read" | "mutate" | "external";
  }>;
}): Promise<RunThroughTurnLoopResult> {
  const throughPlan = await runThroughPlanPipeline({
    start: input.start,
    mode: input.mode,
    runId: input.runId,
    deps: input.deps,
    hydrateSnapshot: input.hydrateSnapshot,
  });

  if (throughPlan.gate?.status === "suspended") {
    return throughPlan;
  }
  if (throughPlan.planGate?.status === "suspended") {
    return throughPlan;
  }

  const sink = input.eventSink ?? input.deps?.eventSink;
  const runId = throughPlan.store.getStore().runId;
  const decision = throughPlan.decision as RuntimeDecisionSketch | undefined;
  // Emit progress before the model turn loop so Desktop is not stuck on
  // "received" for the entire provider round-trip.
  pushRuntimeProgressEvents(sink, {
    runId,
    at: new Date().toISOString(),
    phase: "decided",
    route: decision?.route,
  });

  const ctx = {
    store: throughPlan.store,
    input: input.start,
    mode: input.mode ?? "agent",
    deps: input.deps,
    abortSignal: input.abortSignal,
  };

  const contextBundle =
    input.deps?.enrich != null
      ? await enrichContextWithRetrieval(ctx)
      : enrichContext(ctx);

  pushRuntimeProgressEvents(sink, {
    runId,
    at: new Date().toISOString(),
    phase: "context_ready",
  });
  pushRuntimeProgressEvents(sink, {
    runId,
    at: new Date().toISOString(),
    phase: "prompt_ready",
  });

  const turnLoop =
    input.deps?.model != null
      ? await turnLoopWithPorts(ctx, input.deps, { grant: input.grant })
      : turnLoopShell(ctx, {
          grant: input.grant,
          simulatedToolCalls: input.simulatedToolCalls,
        });

  return { ...throughPlan, contextBundle, turnLoop };
}
