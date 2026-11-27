/** Build RuntimeRunResult from through-turn pump outputs (start facade). */
import { formatPlanAsAnswer } from "../../../modules/planning";
import type { PlanArtifact } from "../../../modules/planning";
import { runtimeRunResultSchema } from "../../contracts/output/RuntimeRunResult";
import type { RuntimeRunResult } from "../../contracts/output/RuntimeRunResult";
import type { RuntimeStartInput } from "../../contracts/input/RuntimeStartInput";
import type { RuntimeDependencies } from "../../ports/RuntimeDependencies";
import { buildPlanFingerprint } from "../build/CheckPlanFreshness";
import { saveRuntimeGateCheckpoint } from "../checkpoint/SaveRuntimeGateCheckpoint";
import { assembleFinishMemoryCommit } from "./AssembleFinishMemoryCommit";
import { buildPendingApprovalFromStore } from "./BuildPendingApprovalFromStore";
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
import type { TaskList } from "../../../modules/task-list";
import { buildSliceProgressHandoff } from "../task/BuildSliceProgressHandoff";
import { finalizeCampaignSliceOnFinish } from "../task/FinalizeCampaignSliceOnFinish";
import { hasOpenExecutionChecklist } from "../task/HydrateStartTaskList";
import {
  clearOrRestoreAfterVerifyPass,
  isVerifyRepairDesk,
  sealVerifyRepairDesk,
  shouldSealVerifyRepairDesk,
} from "../task/SealVerifyRepairDesk";
import { extractAgentVerifyEvidence } from "../task/SummarizeAgentVerifyEvidence";

type UsageSketch = ReturnType<typeof buildRuntimeUsageSketch>;

function formatVerifyNote(input: {
  ranVerify?: boolean;
  runnerStatus?: string;
  reasonCodes?: readonly string[];
  agentEvidence?: string;
}): string | undefined {
  if (input.agentEvidence?.trim()) {
    return input.agentEvidence.trim();
  }
  if (!input.ranVerify) {
    return "Not required this turn";
  }
  switch (input.runnerStatus) {
    case "passed":
      return "Passed";
    case "failed":
      return "Failed";
    case "skipped":
      return "Skipped";
    case "unavailable":
      if (input.reasonCodes?.includes("verification_runner_inline")) {
        return "Finish-phase verify stub only — no checks executed";
      }
      if (input.reasonCodes?.includes("verification_runner_needs_input")) {
        return "Finish-phase verify lacked workspace pin/input";
      }
      return "Finish-phase verify unavailable — use a selective test command";
    case "blocked":
      return "Blocked";
    case "repair_requested":
    case "repair_capped":
      return `Needs repair (${input.runnerStatus})`;
    default:
      if (input.reasonCodes?.includes("verification_runner_inline")) {
        return "Finish-phase verify stub only — no checks executed";
      }
      return "Finish-phase verify ran without a clear result";
  }
}

function sliceProgressFields(store: {
  getSlice: <T>(key: string) => T | undefined;
}, options?: {
  appendLeftover?: boolean;
  advancedThisTurnIds?: readonly string[];
  changedFiles?: readonly string[];
  verifyNote?: string;
}) {
  const planArtifact = store.getSlice<Record<string, unknown>>("planArtifact");
  const taskList = store.getSlice<TaskList>("taskList");
  const completedPlanStepIds = store.getSlice<string[]>("completedPlanStepIds");
  const nextPlanPhaseOffer = store.getSlice<string>("nextPlanPhaseOffer");
  const handoff = buildSliceProgressHandoff({
    ...(planArtifact ? { plan: planArtifact } : {}),
    ...(taskList ? { taskList } : {}),
    ...(completedPlanStepIds ? { completedPlanStepIds } : {}),
    ...(typeof nextPlanPhaseOffer === "string"
      ? { nextPlanPhaseOffer }
      : {}),
    appendLeftover: options?.appendLeftover === true,
    ...(options?.advancedThisTurnIds?.length
      ? { advancedThisTurnIds: options.advancedThisTurnIds }
      : {}),
    ...(options?.changedFiles?.length
      ? { changedFiles: options.changedFiles }
      : {}),
    ...(options?.verifyNote ? { verifyNote: options.verifyNote } : {}),
  });
  return {
    ...(planArtifact ? { plan: planArtifact } : {}),
    ...(taskList ? { taskList } : {}),
    ...handoff,
  };
}

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
    const earlyPayload = through.gate.payload ?? {};
    const earlyClarifyPrompt =
      typeof earlyPayload.clarificationPrompt === "string"
        ? earlyPayload.clarificationPrompt
        : undefined;
    const earlyClarifyOrigin =
      typeof earlyPayload.clarifyOrigin === "string"
        ? earlyPayload.clarifyOrigin
        : undefined;
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
      ...(earlyClarifyPrompt ? { clarificationPrompt: earlyClarifyPrompt } : {}),
      ...(earlyClarifyOrigin ? { clarifyOrigin: earlyClarifyOrigin } : {}),
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
    const planArtifact = through.store.getSlice<Record<string, unknown>>(
      "planArtifact",
    );
    const gatePayload = through.planGate.payload ?? {};
    const clarificationPrompt =
      typeof gatePayload.clarificationPrompt === "string"
        ? gatePayload.clarificationPrompt
        : undefined;
    const clarifyOrigin =
      typeof gatePayload.clarifyOrigin === "string"
        ? gatePayload.clarifyOrigin
        : undefined;
    const checkpointSaved = await saveRuntimeGateCheckpoint(deps, {
      runId,
      requestId: start.runId ?? runId,
      gateKind: through.planGate.kind ?? "plan_approval_required",
      reasonCodes: through.planGate.reasonCodes,
      payload: {
        planFingerprint,
        ...(planArtifact ? { plan: planArtifact } : {}),
        ...(clarificationPrompt ? { clarificationPrompt } : {}),
        ...(clarifyOrigin ? { clarifyOrigin } : {}),
      },
      storeSnapshot: through.store.snapshot(),
      liveStore: through.store,
    });
    const planAnswer =
      through.planGate.kind === "plan_approval_required" && planArtifact
        ? formatPlanAsAnswer(planArtifact as unknown as PlanArtifact)
        : undefined;
    const {
      leftoverAnswer: _planLeftover,
      ...planProgressFields
    } = sliceProgressFields(through.store);
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
      ...(planArtifact ? { plan: planArtifact } : {}),
      ...planProgressFields,
      ...(clarificationPrompt ? { clarificationPrompt } : {}),
      ...(clarifyOrigin ? { clarifyOrigin } : {}),
      ...(planAnswer ? { answer: planAnswer } : {}),
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
    const pendingSlice = through.store.getSlice<{
      toolId?: string;
      invocationId?: string;
      args?: unknown;
    }>("pendingMutationApproval");
    const pendingApproval = buildPendingApprovalFromStore({
      pending: pendingSlice,
      gateToolId: mutationGate.toolId,
      gateInvocationId: mutationGate.invocationId,
    });
    const checkpointSaved = await saveRuntimeGateCheckpoint(deps, {
      runId,
      requestId: start.runId ?? runId,
      gateKind: mutationGate.kind,
      reasonCodes: mutationGate.reasonCodes,
      payload: {
        toolId: mutationGate.toolId,
        invocationId: mutationGate.invocationId,
        ...(pendingApproval
          ? {
              approvalId: pendingApproval.approvalId,
              fingerprint: pendingApproval.fingerprint,
              args: pendingApproval.arguments,
            }
          : {}),
      },
      storeSnapshot: through.store.snapshot(),
      liveStore: through.store,
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
      ...(pendingApproval ? { pendingApproval } : {}),
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
    const verifyChangedPaths = [
      ...new Set(
        [
          ...(start.host?.dirtyPaths ?? []),
          ...(through.store.getSlice<string[]>("changedFiles") ?? []),
          ...(through.store.getSlice<string[]>("mutatedPaths") ?? []),
        ]
          .map((path) => path.replace(/\\/g, "/").trim())
          .filter((path) => path.length > 0),
      ),
    ].slice(0, 64);
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
        changedPaths: verifyChangedPaths,
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
        ...(runnerCodes.length > 0 ? { reasonCodes: runnerCodes.slice(0, 12) } : {}),
        ...(verify.outcome?.checksRun?.length
          ? { checksRun: [...verify.outcome.checksRun].slice(0, 16) }
          : {}),
      }
    : undefined;

  const finishStatus = through.store.isCancelling()
    ? ("cancelled" as const)
    : verify?.suspendContinue
      ? ("suspended" as const)
      : runnerStatus === "blocked"
        ? ("failed" as const)
        : ("completed" as const);

  const changedFiles =
    through.store.getSlice<string[]>("changedFiles") ??
    through.store.getSlice<string[]>("mutatedPaths") ??
    [];
  const editsLanded = Array.isArray(changedFiles) && changedFiles.length > 0;
  const agentEvidence = extractAgentVerifyEvidence(
    usageSketch.toolInvocations.map((item) => ({
      toolId: item.toolId,
      status: item.status,
      ...(item.outputPreview ? { outputPreview: item.outputPreview } : {}),
      ...(item.summary ? { summary: item.summary } : {}),
      ...(typeof item.exitCode === "number" ? { exitCode: item.exitCode } : {}),
    })),
  );
  const sealRepair = shouldSealVerifyRepairDesk({
    ...(agentEvidence ? { agentEvidence } : {}),
    ...(runnerStatus ? { runnerStatus } : {}),
  });
  const verifyPassed =
    agentEvidence?.outcome === "passed" || runnerStatus === "passed";

  const deskReasonCodes: string[] = [];
  if (mode === "agent" && sealRepair) {
    const currentDesk = through.store.getSlice<TaskList>("taskList");
    if (currentDesk && !isVerifyRepairDesk(currentDesk)) {
      through.store.setSlice("priorExecutionTaskList", currentDesk);
    }
    const failureNote =
      agentEvidence?.note ??
      (runnerStatus
        ? `Verification ${runnerStatus}`
        : "Verification failed");
    through.store.setSlice(
      "taskList",
      sealVerifyRepairDesk({
        failureNote,
        ...(agentEvidence?.command
          ? { failedCommand: agentEvidence.command }
          : {}),
        ...(agentEvidence?.hint ? { hint: agentEvidence.hint } : {}),
        ...(verify?.outcome?.checksRun?.length
          ? { checksRun: verify.outcome.checksRun }
          : {}),
        ...(editsLanded ? { changedFiles } : {}),
      }),
    );
    deskReasonCodes.push("tasklist_sealed_verify_repair");
  } else if (mode === "agent" && verifyPassed) {
    const currentDesk = through.store.getSlice<TaskList>("taskList");
    if (isVerifyRepairDesk(currentDesk)) {
      const restored = clearOrRestoreAfterVerifyPass({
        current: currentDesk,
        prior: through.store.getSlice<TaskList>("priorExecutionTaskList"),
      });
      if (restored.taskList) {
        through.store.setSlice("taskList", restored.taskList);
      }
      through.store.setSlice("priorExecutionTaskList", undefined);
      deskReasonCodes.push(...restored.reasonCodes);
    }
  }

  // Do not mark the implementation slice done when verify failed — repair desk owns next.
  const campaignFinalize =
    finishStatus === "completed" && mode === "agent" && !sealRepair
      ? finalizeCampaignSliceOnFinish({
          store: through.store,
          editsLanded,
        })
      : { advanced: false, advancedIds: [] as string[], reasonCodes: [] as string[] };
  const advancedThisTurn =
    through.store.getSlice<string[]>("campaignAdvancedThisTurn") ??
    campaignFinalize.advancedIds;
  const openAfter =
    hasOpenExecutionChecklist(through.store.getSlice<TaskList>("taskList"));
  const verifyNote = formatVerifyNote({
    ranVerify: verify?.ranVerify,
    runnerStatus,
    reasonCodes: runnerCodes,
    ...(agentEvidence?.note ? { agentEvidence: agentEvidence.note } : {}),
  });
  const progressFields = sliceProgressFields(through.store, {
    // Always offer next-slice handoff when the desk still has open work after
    // a completed agent turn that edited (or after finalize advanced a slice).
    appendLeftover:
      finishStatus === "completed" &&
      openAfter &&
      (editsLanded || campaignFinalize.advanced || sealRepair),
    ...(advancedThisTurn.length > 0
      ? { advancedThisTurnIds: advancedThisTurn }
      : {}),
    ...(editsLanded ? { changedFiles } : {}),
    verifyNote,
  });
  const leftover = progressFields.leftoverAnswer;
  const finalAnswer =
    leftover && trimmed
      ? /want me to start the next slice/i.test(trimmed) ||
        /related work may still be open/i.test(trimmed) ||
        /implementation of \*\*/i.test(trimmed) ||
        /next we still have \*\*/i.test(trimmed) ||
        /\|\s*\*\*Next\*\*\s*\|/i.test(trimmed)
        ? trimmed
        : `${trimmed}\n\n${leftover}`
      : leftover && !trimmed
        ? leftover
        : trimmed;
  const {
    leftoverAnswer: _leftoverAnswer,
    ...progressForResult
  } = progressFields;

  const memory = await assembleFinishMemoryCommit({
    mode,
    finishStatus,
    decision,
    verify,
    deps,
    start,
    runId,
    trimmedAnswer: finalAnswer,
    journal: through.turnLoop?.journal ?? [],
    planObjective: through.store.getSlice<{ objective?: string }>(
      "planArtifact",
    )?.objective,
  });

  return runtimeRunResultSchema.parse({
    schemaVersion: 1,
    runId,
    status: finishStatus,
    route: decision.route,
    plateId: decision.plateId,
    grantProfile: decision.grantProfile,
    planningDepth: decision.planningDepth,
    answer: finalAnswer,
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
    ...progressForResult,
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
      ...(progressForResult.nextAction
        ? ["runtime_slice_next_action"]
        : []),
      ...campaignFinalize.reasonCodes,
      ...deskReasonCodes,
      finishStatus === "completed"
        ? "runtime_start_completed"
        : `runtime_start_${finishStatus}`,
    ],
  });
}
