/**
 * Build RuntimeRunResult from through-turn pump outputs (start facade).
 */

import { runtimeRunResultSchema } from "../../contracts/output/RuntimeRunResult";
import type { RuntimeRunResult } from "../../contracts/output/RuntimeRunResult";
import type { RuntimeStartInput } from "../../contracts/input/RuntimeStartInput";
import type { RuntimeDependencies } from "../../ports/RuntimeDependencies";
import { buildPlanFingerprint } from "../build/CheckPlanFreshness";
import { saveRuntimeGateCheckpoint } from "../checkpoint/SaveRuntimeGateCheckpoint";
import { commitRuntimeMemory } from "../memory/CommitRuntimeMemory";
import type { RuntimeParityFields } from "./AssembleRuntimeParityFields";
import type { RuntimeDecisionSketch } from "../../flow/steps/5-Decide";
import type { VerifyFinishSketch } from "../../flow/steps/11-VerifyFinish";
import {
  verifyFinish,
  verifyFinishAsync,
} from "../../flow/steps/11-VerifyFinish";
import type { RunThroughTurnLoopResult } from "../../flow/RunThroughTurnLoop";
import { pushRuntimeProgressEvents } from "../events/PushRuntimeProgressEvents";
import type { RuntimeEventSink } from "../events/RuntimeEventChannel";
import { buildRuntimeUsageSketch } from "../usage/BuildRuntimeUsageSketch";

type UsageSketch = ReturnType<typeof buildRuntimeUsageSketch>;

export async function assembleRuntimeStartResult(input: {
  start: RuntimeStartInput;
  mode: "ask" | "plan" | "agent";
  through: RunThroughTurnLoopResult;
  decision: RuntimeDecisionSketch;
  deps?: RuntimeDependencies;
  sink?: RuntimeEventSink;
  usageSketch: UsageSketch;
  parity: RuntimeParityFields;
  storeHydrated: boolean;
  heartbeatReasonCodes: readonly string[];
}): Promise<RuntimeRunResult> {
  const {
    start,
    mode,
    through,
    decision,
    deps,
    sink,
    usageSketch,
    parity,
    storeHydrated,
  } = input;
  const body = decision.routeBody;
  const runId = through.store.getStore().runId;

  if (through.gate?.status === "suspended") {
    return runtimeRunResultSchema.parse({
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
  }

  if (through.planGate?.status === "suspended") {
    const planFingerprint = buildPlanFingerprint({
      runId,
      plateId: decision.plateId,
    });
    through.store.setSlice("planFingerprint", planFingerprint);
    const checkpointSaved = await saveRuntimeGateCheckpoint(deps, {
      runId,
      requestId: start.runId ?? runId,
      gateKind: through.planGate.kind ?? "plan_approval_required",
      reasonCodes: through.planGate.reasonCodes,
      payload: { planFingerprint },
      storeSnapshot: through.store.snapshot(),
    });
    return runtimeRunResultSchema.parse({
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
  }

  if (through.turnLoop?.gate?.status === "suspended") {
    const mutationGate = through.turnLoop.gate;
    const checkpointSaved = await saveRuntimeGateCheckpoint(deps, {
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
    return runtimeRunResultSchema.parse({
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
  }

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
        deps,
      },
      {
        runId,
        runner: deps?.verification,
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

  return runtimeRunResultSchema.parse({
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
      ...input.heartbeatReasonCodes,
      ...(storeHydrated ? ["runtime_store_hydrated"] : []),
      finishStatus === "completed"
        ? "runtime_start_completed"
        : `runtime_start_${finishStatus}`,
    ],
  });
}
