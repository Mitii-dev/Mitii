/**
 * Finish-path desk policy: verify-repair seal/update/restore, then weak-desk reconcile.
 * Keeps AssembleRuntimeStartResult under the line-budget and owns one action.
 */

import type { PlanArtifact } from "../../../modules/planning";
import type { TaskList } from "../../../modules/task-list";
import { reconcileExecutionDeskOnFinish } from "../plan/MaterializeExecutionDesk";
import {
  clearOrRestoreAfterVerifyPass,
  isVerifyDeskSoftPass,
  isVerifyRepairDesk,
  sealVerifyRepairDesk,
  updateVerifyRepairDeskOnFail,
} from "./SealVerifyRepairDesk";
import type { AgentVerifyEvidence } from "./SummarizeAgentVerifyEvidence";

export type FinishDeskStore = {
  getSlice: <T>(key: string) => T | undefined;
  setSlice: (key: string, value: unknown) => void;
};

export function applyFinishDeskPolicy(input: {
  store: FinishDeskStore;
  mode: "ask" | "plan" | "agent";
  sealRepair: boolean;
  verifyPassed: boolean;
  finishStatus: "completed" | "cancelled" | "suspended" | "failed";
  agentEvidence?: AgentVerifyEvidence;
  runnerStatus?: string;
  runnerReasonCodes?: readonly string[];
  checksRun?: readonly string[];
  changedFiles: readonly string[];
  editsLanded: boolean;
  answer?: string;
}): { reasonCodes: string[] } {
  const reasonCodes: string[] = [];
  const { store, mode } = input;

  if (mode === "agent" && input.sealRepair) {
    const currentDesk = store.getSlice<TaskList>("taskList");
    const failureNote =
      input.agentEvidence?.note ??
      (input.runnerStatus
        ? `Verification ${input.runnerStatus}`
        : "Verification failed");
    const failureFields = {
      failureNote,
      ...(input.agentEvidence?.command
        ? { failedCommand: input.agentEvidence.command }
        : {}),
      ...(input.agentEvidence?.hint ? { hint: input.agentEvidence.hint } : {}),
      ...(input.checksRun?.length ? { checksRun: input.checksRun } : {}),
      ...(input.editsLanded ? { changedFiles: input.changedFiles } : {}),
    };
    if (currentDesk && isVerifyRepairDesk(currentDesk)) {
      store.setSlice(
        "taskList",
        updateVerifyRepairDeskOnFail({
          current: currentDesk,
          ...failureFields,
          editsLanded: input.editsLanded,
        }),
      );
      reasonCodes.push("tasklist_updated_verify_repair");
    } else {
      if (currentDesk && !isVerifyRepairDesk(currentDesk)) {
        store.setSlice("priorExecutionTaskList", currentDesk);
      }
      store.setSlice("taskList", sealVerifyRepairDesk(failureFields));
      reasonCodes.push("tasklist_sealed_verify_repair");
    }
    return { reasonCodes };
  }

  // Green selective tests OR env/infra soft-pass — restore campaign so Continue
  // is not stuck on Fix→Re-verify after sandbox/EPERM noise.
  const softPass =
    input.verifyPassed ||
    isVerifyDeskSoftPass({
      ...(input.agentEvidence ? { agentEvidence: input.agentEvidence } : {}),
      ...(input.runnerStatus ? { runnerStatus: input.runnerStatus } : {}),
      ...(input.runnerReasonCodes?.length
        ? { runnerReasonCodes: input.runnerReasonCodes }
        : {}),
    });

  if (mode === "agent" && softPass) {
    const currentDesk = store.getSlice<TaskList>("taskList");
    if (isVerifyRepairDesk(currentDesk)) {
      const restored = clearOrRestoreAfterVerifyPass({
        current: currentDesk,
        prior: store.getSlice<TaskList>("priorExecutionTaskList"),
      });
      store.setSlice("taskList", restored.taskList);
      store.setSlice("priorExecutionTaskList", undefined);
      reasonCodes.push(...restored.reasonCodes);
    }
  }

  if (
    input.finishStatus !== "completed" ||
    input.sealRepair ||
    isVerifyRepairDesk(store.getSlice<TaskList>("taskList"))
  ) {
    return { reasonCodes };
  }

  const reconciled = reconcileExecutionDeskOnFinish({
    plan: store.getSlice<PlanArtifact>("planArtifact"),
    answer: input.answer,
    current: store.getSlice<TaskList>("taskList"),
  });

  if (reconciled.status === "applied" && reconciled.taskList) {
    store.setSlice("taskList", reconciled.taskList);
    reasonCodes.push(...reconciled.reasonCodes);
  } else if (reconciled.clearedWeak) {
    // Clears weak invents and leaked discovery so Continue is not "Find entrypoint".
    store.setSlice("taskList", undefined);
    reasonCodes.push(...reconciled.reasonCodes);
  }

  return { reasonCodes };
}
