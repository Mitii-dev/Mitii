/**
 * Suspend for grant expansion after a tool batch.
 */
import type { AgentRunResult } from "../contracts";
import {
  consultRuntimeGate,
  hubSuspendKind,
} from "../helpers/ConsultRuntimeGate";
import { saveSuspendedRun } from "../helpers/SaveSuspendedRun";
import type { AgentEngineRuntime } from "./runtime";
import type { ToolLoopOutcome } from "./types";
import type { VerificationSuspendCommon } from "./verificationFinishSuspendTypes";

export async function finishIfGrantExpansionRequired(
  runtime: AgentEngineRuntime,
  params: VerificationSuspendCommon & {
    currentOutcome: Extract<ToolLoopOutcome, { kind: "grant_expansion_required" }>;
  },
): Promise<AgentRunResult> {
  const {
    runId,
    requestId,
    input,
    decision,
    bus,
    pinnedState,
    currentOutcome,
    reasonCodes,
    warnings,
    budget,
    startedAtMs,
    finish,
    taskListRef,
    repoBuildStateBefore,
    plan,
  } = params;

    if (!runtime.deps.checkpointStore) {
      await runtime.safeUnpin(runId, pinnedState);
      reasonCodes.push("misconfigured");
      return finish({
        status: "failed",
        reasonCodes,
        error: {
          code: "misconfigured",
          message: "Grant expansion suspend requires a checkpoint store.",
        },
      });
    }

    const expansionId = runtime.deps.idGenerator.next("gexp");
    // S10-EVAC: grant expansion via gates hub.
    const grantVerdict = consultRuntimeGate("after_tool", {
      runId,
      needsGrantExpansion: true,
    });
    const suspendKind = hubSuspendKind(
      grantVerdict,
      "grant_expansion_required",
    ) as NonNullable<AgentRunResult["suspension"]>["kind"];
    reasonCodes.push("grant_expansion_suspended");
    warnings.push("gates_hub:grant_expansion");
    await saveSuspendedRun({
      store: runtime.deps.checkpointStore,
      checkpoint: {
      runId,
      requestId,
      ...(runtime.contextEpochs.get(runId)
        ? { contextEpoch: runtime.contextEpochs.get(runId) }
        : {}),
      suspensionKind: suspendKind,
      input,
      decision,
      pinnedState,
      messages: currentOutcome.messages,
      toolCacheEntries: currentOutcome.toolCache.entries(),
      pendingGrantExpansion: {
        expansionId,
        extraPaths: [...currentOutcome.extraPaths],
        ...(currentOutcome.externalRoots &&
        currentOutcome.externalRoots.length > 0
          ? { externalRoots: [...currentOutcome.externalRoots] }
          : {}),
        ...(currentOutcome.pendingToolCalls &&
        currentOutcome.pendingToolCalls.length > 0
          ? { pendingToolCalls: [...currentOutcome.pendingToolCalls] }
          : {}),
      },
      changedFiles: currentOutcome.changedFiles,
      mutationCheckpointIds: currentOutcome.mutationCheckpointIds,
      reasonCodes,
      warnings,
      usage: budget.snapshot(),
      startedAtMs,
      excludedWaitMs: budget.getExcludedWaitMs(),
      suspendedAtMs: Date.now(),
      repoBuildStateBefore,
      repoBuildStateAfter: params.repoBuildStateAfter,
      ...(taskListRef.current ? { taskList: taskListRef.current } : {}),
      ...(taskListRef.completedPlanStepIds &&
      taskListRef.completedPlanStepIds.length > 0
        ? { completedPlanStepIds: [...taskListRef.completedPlanStepIds] }
        : {}),
      ...(plan ? { plan } : {}),
      },
    });

    const allPreview = [
      ...currentOutcome.extraPaths,
      ...(currentOutcome.externalRoots ?? []),
    ];
    const pathPreview = allPreview.slice(0, 5).join(", ");
    const more =
      allPreview.length > 5 ? ` (+${allPreview.length - 5} more)` : "";
    const rationale =
      (currentOutcome.externalRoots?.length ?? 0) > 0
        ? `Access outside the workspace requires permission for: ${pathPreview}${more}.`
        : `Workspace access expansion required for: ${pathPreview}${more}.`;
    runtime.emit(bus, {
      type: "suspended",
      runId,
      kind: "grant_expansion_required",
      rationale,
      at: runtime.isoNow(),
    });

    return finish({
      status: "suspended",
      route: decision.route,
      planningDepth: decision.planningDepth,
      suspension: {
        kind: "grant_expansion_required",
        rationale,
        grantExpansion: {
          expansionId,
          extraPaths: currentOutcome.extraPaths.slice(0, 50),
          ...(currentOutcome.externalRoots &&
          currentOutcome.externalRoots.length > 0
            ? {
                externalRoots: currentOutcome.externalRoots.slice(0, 20),
              }
            : {}),
          currentPathScopes: decision.toolGrant.pathScopes.slice(0, 20),
        },
      },
      reasonCodes,
    });
}

