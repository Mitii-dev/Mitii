import { runtimeStartInputSchema } from "../contracts/input/RuntimeStartInput";
import type { RuntimeStartInput } from "../contracts/input/RuntimeStartInput";
import {
  runtimeRunResultSchema,
  type RuntimeRunResult,
} from "../contracts/output/RuntimeRunResult";
import { saveRuntimeGateCheckpoint } from "../helpers/checkpoint/SaveRuntimeGateCheckpoint";
import { saveRuntimeSessionCarry } from "../helpers/checkpoint/SaveRuntimeSessionCarry";
import { buildPlanFingerprint } from "../helpers/build/CheckPlanFreshness";
import { commitRuntimeMemory } from "../helpers/memory/CommitRuntimeMemory";
import { assembleRuntimeParityFields } from "../helpers/parity/AssembleRuntimeParityFields";
import { pushRuntimeProgressEvents } from "../helpers/events/PushRuntimeProgressEvents";
import type { RuntimeEventSink } from "../helpers/events/RuntimeEventChannel";
import type { StoreSnapshot } from "../helpers/store/StoreSnapshot";
import { buildRuntimeUsageSketch } from "../helpers/usage/BuildRuntimeUsageSketch";
import { runThroughTurnLoop } from "./RunThroughTurnLoop";
import { verifyFinish } from "./steps/11-VerifyFinish";
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

  const parity = assembleRuntimeParityFields({
    startMcpServerIds: start.mcpServerIds,
    deps: input.deps,
    contextBundle: contextBundle ?? through.contextBundle,
    turnLoop: through.turnLoop,
    suspendedGateKind,
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
    if (body?.runVerify) {
      pushRuntimeProgressEvents(sink, {
        runId,
        at: new Date().toISOString(),
        phase: "verifying",
      });
      verifyFinish({
        store: through.store,
        input: start,
        mode,
      });
    } else {
      through.store.setSlice("verifyFinish", {
        ranVerify: false,
        invalidated: false,
        finished: true,
        reasonCodes: ["verify_skipped_by_route"],
      });
    }

    let verify = through.store.getSlice<VerifyFinishSketch>("verifyFinish");
    const runnerCodes: string[] = [];
    let runnerStatus: "passed" | "failed" | "skipped" | undefined;

    if (verify?.ranVerify && input.deps?.verification) {
      const outcome = await input.deps.verification.run({
        runId,
        route: decision.route,
      });
      runnerStatus = outcome.status;
      runnerCodes.push(...outcome.reasonCodes);
      verify = {
        ...verify,
        reasonCodes: [...(verify.reasonCodes ?? []), ...outcome.reasonCodes],
      };
      through.store.setSlice("verifyFinish", verify);
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

    const memory = commitRuntimeMemory({
      mode,
      status: through.store.isCancelling() ? "cancelled" : "completed",
      route: decision.route,
      verify: verifySketch,
    });

    result = runtimeRunResultSchema.parse({
      schemaVersion: 1,
      runId,
      status: through.store.isCancelling() ? "cancelled" : "completed",
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
      reasonCodes: [
        ...decision.reasonCodes,
        ...(through.turnLoop?.reasonCodes ?? []),
        ...(verify?.reasonCodes ?? []),
        ...runnerCodes,
        ...memory.reasonCodes,
        ...parity.reasonCodes,
        ...(storeHydrated ? ["runtime_store_hydrated"] : []),
        "runtime_start_completed",
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
