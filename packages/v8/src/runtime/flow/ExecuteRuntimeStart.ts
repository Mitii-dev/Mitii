import { runtimeStartInputSchema } from "../contracts/input/RuntimeStartInput";
import type { RuntimeStartInput } from "../contracts/input/RuntimeStartInput";
import {
  runtimeRunResultSchema,
  type RuntimeRunResult,
} from "../contracts/output/RuntimeRunResult";
import { saveRuntimeGateCheckpoint } from "../helpers/checkpoint/SaveRuntimeGateCheckpoint";
import { saveRuntimeSessionCarry } from "../helpers/checkpoint/SaveRuntimeSessionCarry";
import { buildPlanFingerprint } from "../helpers/build/CheckPlanFreshness";
import { maybeSaveHeartbeatCheckpoint } from "../helpers/heartbeat/SaveHeartbeatCheckpoint";
import { commitRuntimeMemory } from "../helpers/memory/CommitRuntimeMemory";
import { assembleRuntimeParityFields } from "../helpers/parity/AssembleRuntimeParityFields";
import { pushRuntimeProgressEvents } from "../helpers/events/PushRuntimeProgressEvents";
import type { RuntimeEventSink } from "../helpers/events/RuntimeEventChannel";
import type { StoreSnapshot } from "../helpers/store/StoreSnapshot";
import { buildRuntimeUsageSketch } from "../helpers/usage/BuildRuntimeUsageSketch";
import { runThroughTurnLoop } from "./RunThroughTurnLoop";
import {
  verifyFinish,
  verifyFinishAsync,
} from "./steps/11-VerifyFinish";
import type { RuntimeDecisionSketch } from "./steps/5-Decide";
import type { VerifyFinishSketch } from "./steps/11-VerifyFinish";
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
    deps: input.deps,
    hydrateSnapshot: input.hydrateSnapshot,
    abortSignal: input.abortSignal,
  });

  const decision = through.decision as RuntimeDecisionSketch;
  const body = decision.routeBody;
  const runId = through.store.getStore().runId;
  pushRuntimeProgressEvents(sink, {
    runId,
    at: new Date().toISOString(),
    phase: "decided",
    route: decision.route,
  });
  if (through.contextBundle || through.store.getSlice("contextBundle")) {
    pushRuntimeProgressEvents(sink, {
      runId,
      at: new Date().toISOString(),
      phase: "context_ready",
    });
  }
  if (through.turnLoop) {
    pushRuntimeProgressEvents(sink, {
      runId,
      at: new Date().toISOString(),
      phase: "prompt_ready",
    });
  }
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

  // S11-HEART: durable RunState freeze between turns (not a user gate).
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

  let result: RuntimeRunResult;

  if (through.gate?.status === "suspended") {
    result = runtimeRunResultSchema.parse({
      schemaVersion: 1,
      runId,
      status: "suspended",
      route: decision.route,
      plateId: decision.plateId,
      grantProfile: decision.grantProfile,
      planningDepth: decision.planningDepth,
      gateKind: through.gate.kind,
      checkpointSaved: through.gate.checkpointSaved,
      storeHydrated,
      usage: usageSketch.usage,
      toolInvocations: usageSketch.toolInvocations,
      mcpServerIds: parity.mcpServerIds,
      handoff: parity.handoff,
      context: parity.context,
      prompt: parity.prompt,
      reasonCodes: [
        ...decision.reasonCodes,
        ...through.gate.reasonCodes,
        ...parity.reasonCodes,
        ...(storeHydrated ? ["runtime_store_hydrated"] : []),
        "runtime_start_suspended",
      ],
    });
  } else if (through.planGate?.status === "suspended") {
    const planFingerprint = buildPlanFingerprint({
      runId,
      plateId: decision.plateId,
    });
    through.store.setSlice("planFingerprint", planFingerprint);
    const checkpointSaved = await saveRuntimeGateCheckpoint(input.deps, {
      runId,
      requestId: start.runId ?? runId,
      gateKind: through.planGate.kind ?? "plan_approval_required",
      reasonCodes: through.planGate.reasonCodes,
      payload: { planFingerprint },
      storeSnapshot: through.store.snapshot(),
    });
    result = runtimeRunResultSchema.parse({
      schemaVersion: 1,
      runId,
      status: "suspended",
      route: decision.route,
      plateId: decision.plateId,
      grantProfile: decision.grantProfile,
      planningDepth: decision.planningDepth,
      gateKind: through.planGate.kind,
      checkpointSaved: checkpointSaved || through.planGate.checkpointSaved,
      storeHydrated,
      planFingerprint,
      usage: usageSketch.usage,
      toolInvocations: usageSketch.toolInvocations,
      mcpServerIds: parity.mcpServerIds,
      handoff: parity.handoff,
      context: parity.context,
      prompt: parity.prompt,
      reasonCodes: [
        ...decision.reasonCodes,
        ...through.planGate.reasonCodes,
        ...parity.reasonCodes,
        ...(storeHydrated ? ["runtime_store_hydrated"] : []),
        "runtime_start_plan_gate",
      ],
    });
  } else if (through.turnLoop?.gate?.status === "suspended") {
    const mutationGate = through.turnLoop.gate;
    const checkpointSaved = await saveRuntimeGateCheckpoint(input.deps, {
      runId,
      requestId: start.runId ?? runId,
      gateKind: mutationGate.kind,
      reasonCodes: mutationGate.reasonCodes,
      payload: {
        toolId: mutationGate.toolId,
        invocationId: mutationGate.invocationId,
      },
      storeSnapshot: through.store.snapshot(),
    });
    result = runtimeRunResultSchema.parse({
      schemaVersion: 1,
      runId,
      status: "suspended",
      route: decision.route,
      plateId: decision.plateId,
      grantProfile: decision.grantProfile,
      planningDepth: decision.planningDepth,
      gateKind: mutationGate.kind,
      checkpointSaved,
      storeHydrated,
      usage: usageSketch.usage,
      toolInvocations: usageSketch.toolInvocations,
      mcpServerIds: parity.mcpServerIds,
      handoff: parity.handoff,
      context: parity.context,
      prompt: parity.prompt,
      reasonCodes: [
        ...decision.reasonCodes,
        ...(through.turnLoop.reasonCodes ?? []),
        ...mutationGate.reasonCodes,
        ...parity.reasonCodes,
        ...(storeHydrated ? ["runtime_store_hydrated"] : []),
        "runtime_start_mutation_gate",
      ],
    });
  } else {
    let verify: VerifyFinishSketch | undefined;
    const runnerCodes: string[] = [];
    let runnerStatus:
      | "passed"
      | "failed"
      | "skipped"
      | "unavailable"
      | "repair_requested"
      | "repair_capped"
      | "blocked"
      | undefined;

    if (body?.runVerify || decision.verification?.required) {
      pushRuntimeProgressEvents(sink, {
        runId,
        at: new Date().toISOString(),
        phase: "verifying",
      });
      verify = await verifyFinishAsync(
        {
          store: through.store,
          input: start,
          mode,
          deps: input.deps,
        },
        {
          runId,
          runner: input.deps?.verification,
          workspaceRoot: start.host?.cwd,
          changedPaths: start.host?.dirtyPaths,
          onProgress: (event) => {
            if (event.phase === "verify_started") {
              pushRuntimeProgressEvents(sink, {
                runId,
                at: new Date().toISOString(),
                phase: "verifying",
              });
            }
          },
        },
      );
      if (verify.outcome) {
        runnerStatus = verify.outcome.status;
        runnerCodes.push(...verify.outcome.reasonCodes);
      }
    } else {
      verify = verifyFinish({
        store: through.store,
        input: start,
        mode,
      });
    }

    const answer = through.store.getSlice<string>("lastAssistantText");
    const trimmed =
      typeof answer === "string" && answer.trim().length > 0
        ? answer.trim()
        : undefined;

    const usage =
      trimmed || usageSketch.usage.modelCalls > 0
        ? {
            ...usageSketch.usage,
            modelCalls: Math.max(1, usageSketch.usage.modelCalls),
          }
        : usageSketch.usage;

    const verifySketch = verify
      ? {
          ranVerify: verify.ranVerify,
          invalidated: verify.invalidated,
          finished: verify.finished,
          ...(runnerStatus ? { runnerStatus } : {}),
        }
      : undefined;

    // repair_capped → continue_required suspend; blocked → failed; else complete.
    const finishStatus = through.store.isCancelling()
      ? ("cancelled" as const)
      : verify?.suspendContinue
        ? ("suspended" as const)
        : runnerStatus === "blocked"
          ? ("failed" as const)
          : ("completed" as const);

    const memory = commitRuntimeMemory({
      mode,
      status: finishStatus,
      route: decision.route,
      verify: verify
        ? {
            ranVerify: verify.ranVerify,
            invalidated: verify.invalidated,
            outcomeStatus: verify.outcome?.status,
          }
        : undefined,
    });

    result = runtimeRunResultSchema.parse({
      schemaVersion: 1,
      runId,
      status: finishStatus,
      route: decision.route,
      plateId: decision.plateId,
      grantProfile: decision.grantProfile,
      planningDepth: decision.planningDepth,
      answer: trimmed,
      usage,
      toolInvocations: usageSketch.toolInvocations,
      verify: verifySketch,
      memoryCommit: {
        committed: memory.committed,
        factCount: memory.factCount,
      },
      mcpServerIds: parity.mcpServerIds,
      context: parity.context,
      prompt: parity.prompt,
      storeHydrated,
      ...(finishStatus === "suspended"
        ? { gateKind: "continue_required" as const }
        : {}),
      reasonCodes: [
        ...decision.reasonCodes,
        ...(through.turnLoop?.reasonCodes ?? []),
        ...(verify?.reasonCodes ?? []),
        ...runnerCodes,
        ...memory.reasonCodes,
        ...parity.reasonCodes,
        ...heartbeat.reasonCodes,
        ...(storeHydrated ? ["runtime_store_hydrated"] : []),
        finishStatus === "completed"
          ? "runtime_start_completed"
          : `runtime_start_${finishStatus}`,
      ],
    });
  }

  await saveRuntimeSessionCarry(input.deps, {
    runId: result.runId,
    message: start.message,
    mode,
    gateKind: result.gateKind,
  });

  return result;
}
