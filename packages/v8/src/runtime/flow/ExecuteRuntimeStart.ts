import { runtimeStartInputSchema } from "../contracts/input/RuntimeStartInput";
import type { RuntimeStartInput } from "../contracts/input/RuntimeStartInput";
import type { RuntimeRunResult } from "../contracts/output/RuntimeRunResult";
import { saveRuntimeSessionCarry } from "../helpers/checkpoint/SaveRuntimeSessionCarry";
import { maybeSaveHeartbeatCheckpoint } from "../helpers/heartbeat/SaveHeartbeatCheckpoint";
import { assembleRuntimeParityFields } from "../helpers/parity/AssembleRuntimeParityFields";
import { assembleRuntimeStartResult } from "../helpers/parity/AssembleRuntimeStartResult";
import { pushRuntimeProgressEvents } from "../helpers/events/PushRuntimeProgressEvents";
import type { RuntimeEventSink } from "../helpers/events/RuntimeEventChannel";
import type { StoreSnapshot } from "../helpers/store/StoreSnapshot";
import { buildRuntimeUsageSketch } from "../helpers/usage/BuildRuntimeUsageSketch";
import { runThroughTurnLoop } from "./RunThroughTurnLoop";
import type { RuntimeDecisionSketch } from "./steps/5-Decide";
import type { ContextBundleSketch } from "./steps/9-EnrichContext";
import type { RuntimeDependencies } from "../ports/RuntimeDependencies";

export interface ExecuteRuntimeStartInput {
  start: RuntimeStartInput;
  mode?: "ask" | "plan" | "agent";
  runId?: string;
  deps?: RuntimeDependencies;
  hydrateSnapshot?: StoreSnapshot;
  /** Live MitiiRun event sink — progressive stages while the pump runs. */
  eventSink?: RuntimeEventSink;
  /** Cooperative cancel for in-flight model/tool work. */
  abortSignal?: AbortSignal;
}

/**
 * Runtime start — shell pump 1–11.
 * When deps.model is set, turn loop calls the injected model/tool ports.
 * Persists session carry when deps.sessionStore is composed.
 * Persists gate checkpoints when deps.checkpointStore is composed.
 */
export async function executeRuntimeStart(
  input: ExecuteRuntimeStartInput,
): Promise<RuntimeRunResult> {
  const start = runtimeStartInputSchema.parse(input.start);
  const mode = input.mode ?? "agent";
  const sink = input.eventSink ?? input.deps?.eventSink;
  const deps =
    sink && input.deps
      ? { ...input.deps, eventSink: sink }
      : sink
        ? { ...input.deps, eventSink: sink }
        : input.deps;
  const progressAt = new Date().toISOString();
  const provisionalRunId = input.runId ?? start.runId ?? `run_${Date.now()}`;
  pushRuntimeProgressEvents(sink, {
    runId: provisionalRunId,
    at: progressAt,
    phase: "received",
  });

  const through = await runThroughTurnLoop({
    start,
    mode,
    runId: input.runId ?? start.runId,
    deps,
    hydrateSnapshot: input.hydrateSnapshot,
    abortSignal: input.abortSignal,
    eventSink: sink,
  });

  const decision = through.decision as RuntimeDecisionSketch;
  const runId = through.store.getStore().runId;
  // decided / context_ready / prompt_ready are emitted inside runThroughTurnLoop
  // before the model turn loop so hosts see progress during provider waits.
  const usageSketch = buildRuntimeUsageSketch(through.turnLoop);
  const storeHydrated = through.hydratedFromSnapshot === true;
  const contextBundle = through.store.getSlice<ContextBundleSketch>(
    "contextBundle",
  );

  const suspendedGateKind =
    through.gate?.status === "suspended"
      ? through.gate.kind
      : through.planGate?.status === "suspended"
        ? through.planGate.kind
        : through.turnLoop?.gate?.status === "suspended"
          ? through.turnLoop.gate.kind
          : undefined;

  const turnCount = Math.max(
    1,
    usageSketch.usage.loopIterations ||
      through.turnLoop?.journal?.length ||
      1,
  );
  const lastHb = through.store.getSlice<{ turnCount?: number }>("lastHeartbeat");
  const turnsSince =
    lastHb?.turnCount != null
      ? Math.max(0, turnCount - lastHb.turnCount)
      : turnCount;
  const mutationBatchSucceeded = (through.turnLoop?.journal ?? []).some(
    (j) =>
      j.status === "succeeded" &&
      (j.effectClass === "mutate" || j.effectClass === "external"),
  );
  const heartbeat =
    suspendedGateKind == null
      ? await maybeSaveHeartbeatCheckpoint({
          deps: input.deps,
          store: through.store,
          runId,
          requestId: runId,
          mode,
          route: decision.route,
          turnCount,
          turnsSinceLastHeartbeat: turnsSince,
          mutationBatchSucceeded,
          heartbeat: input.deps?.heartbeat,
          heartbeatEveryTurns: input.deps?.heartbeatEveryTurns,
        })
      : {
          saved: false,
          policyEnabled: false,
          reasonCodes: ["heartbeat_skip_suspended"],
        };

  const handoffHistory = through.store.getSlice<
    Array<{
      fromTaskId: string;
      toTaskId?: string;
      doneSummary: string;
    }>
  >("taskHandoffs");
  const latestNote =
    handoffHistory && handoffHistory.length > 0
      ? handoffHistory[handoffHistory.length - 1]
      : undefined;

  const parity = assembleRuntimeParityFields({
    startMcpServerIds: start.mcpServerIds,
    deps: input.deps,
    contextBundle: contextBundle ?? through.contextBundle,
    turnLoop: through.turnLoop,
    suspendedGateKind,
    latestHandoff: latestNote
      ? {
          fromTaskId: latestNote.fromTaskId,
          toTaskId: latestNote.toTaskId,
          doneSummary: latestNote.doneSummary,
        }
      : undefined,
  });

  const result = await assembleRuntimeStartResult({
    start,
    mode,
    through,
    decision,
    deps: input.deps,
    sink,
    usageSketch,
    parity,
    storeHydrated,
    heartbeatReasonCodes: heartbeat.reasonCodes,
  });

  await saveRuntimeSessionCarry(input.deps, {
    runId: result.runId,
    message: start.message,
    mode,
    gateKind: result.gateKind,
  });

  return result;
}
