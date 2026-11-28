/**
 * Single owner for post-plan / finish execution desk materialization.
 * Prefer structured plan derive → plan-step soft seed → LLM steppers in text.
 * Never invent a desk from a raw user brief.
 */

import type { PlanArtifact } from "../../../modules/planning";
import type { TaskList } from "../../../modules/task-list";
import {
  deriveTaskListAfterPlan,
  isWeakSeededTaskList,
  seedExecutionTaskListFromObjective,
  seedExecutionTaskListFromPlanArtifact,
  type DeriveTaskListAfterPlanResult,
} from "./DeriveTaskListAfterPlan";

export type MaterializeExecutionDeskInput = {
  plan?: PlanArtifact;
  /** Plan objective or assistant answer — steppers only, never raw ask dump. */
  seedText?: string;
  maxTasks?: number;
  /** Existing desk; sealed non-weak execution lists are kept. */
  current?: TaskList;
};

export type MaterializeExecutionDeskResult = DeriveTaskListAfterPlanResult & {
  /** True when a soft seed (not strict derive) was applied. */
  softSeeded: boolean;
  /** True when a weak/invented desk was cleared. */
  clearedWeak: boolean;
};

function isDiscoveryDesk(taskList: TaskList | undefined): boolean {
  if (!taskList) return false;
  return taskList.purpose === "discovery" || taskList.source === "discovery";
}

function hasSealedExecutionDesk(taskList: TaskList | undefined): boolean {
  if (!taskList?.items?.length) return false;
  if (isDiscoveryDesk(taskList)) return false;
  return !isWeakSeededTaskList(taskList);
}

/**
 * Materialize an execution checklist from plan structure (and optional steppers).
 * Call from plan pipeline and finish reconcile — do not reimplement this ladder.
 */
export function materializeExecutionDesk(
  input: MaterializeExecutionDeskInput,
): MaterializeExecutionDeskResult {
  if (hasSealedExecutionDesk(input.current)) {
    return {
      taskList: input.current,
      status: "skipped",
      softSeeded: false,
      clearedWeak: false,
      reasonCodes: ["tasklist_keep_sealed_execution"],
    };
  }

  const derived = deriveTaskListAfterPlan({
    plan: input.plan,
    maxTasks: input.maxTasks,
  });
  if (derived.taskList && derived.taskList.items.length > 0) {
    return {
      ...derived,
      softSeeded: false,
      clearedWeak: isWeakSeededTaskList(input.current),
    };
  }

  if (input.plan) {
    const fromPlan = seedExecutionTaskListFromPlanArtifact(input.plan);
    if (fromPlan.taskList && fromPlan.taskList.items.length > 0) {
      return {
        taskList: fromPlan.taskList,
        status: "applied",
        softSeeded: true,
        clearedWeak: isWeakSeededTaskList(input.current),
        reasonCodes: [
          ...derived.reasonCodes,
          ...fromPlan.reasonCodes,
        ],
      };
    }
  }

  const seedText = input.seedText?.trim() ?? "";
  if (seedText.length > 0) {
    const fromText = seedExecutionTaskListFromObjective(seedText);
    if (
      fromText.taskList &&
      fromText.taskList.items.length > 0 &&
      !isWeakSeededTaskList(fromText.taskList)
    ) {
      return {
        taskList: fromText.taskList,
        status: "applied",
        softSeeded: true,
        clearedWeak: isWeakSeededTaskList(input.current),
        reasonCodes: [
          ...derived.reasonCodes,
          ...fromText.reasonCodes,
        ],
      };
    }
  }

  const hadWeak = isWeakSeededTaskList(input.current);
  return {
    status: "skipped",
    softSeeded: false,
    clearedWeak: hadWeak,
    reasonCodes: [
      ...derived.reasonCodes,
      ...(hadWeak
        ? ["tasklist_cleared_weak_seed"]
        : ["tasklist_seed_skipped_no_llm_steps"]),
    ],
  };
}

/**
 * Finish-path reconcile: materialize when empty/weak/discovery; clear junk desks.
 * Discovery is recon-only — never leave it as the host Continue target.
 * Does not replace a healthy sealed campaign checklist.
 */
export function reconcileExecutionDeskOnFinish(input: {
  plan?: PlanArtifact;
  answer?: string;
  current?: TaskList;
}): MaterializeExecutionDeskResult {
  const empty = !input.current?.items?.length;
  const weak = isWeakSeededTaskList(input.current);
  const discovery = isDiscoveryDesk(input.current);
  if (!empty && !weak && !discovery) {
    return {
      taskList: input.current,
      status: "skipped",
      softSeeded: false,
      clearedWeak: false,
      reasonCodes: ["tasklist_finish_keep_desk"],
    };
  }
  const materialized = materializeExecutionDesk({
    plan: input.plan,
    seedText: input.answer,
    current: input.current,
  });
  if (
    materialized.status === "applied" &&
    materialized.taskList &&
    !isDiscoveryDesk(materialized.taskList)
  ) {
    return {
      ...materialized,
      clearedWeak: materialized.clearedWeak || weak || discovery,
    };
  }
  // Still discovery / empty after materialize → clear so Continue dies cleanly.
  if (discovery || weak) {
    return {
      status: "skipped",
      softSeeded: false,
      clearedWeak: true,
      reasonCodes: [
        ...materialized.reasonCodes,
        discovery
          ? "tasklist_cleared_discovery"
          : "tasklist_cleared_weak_seed",
      ],
    };
  }
  return materialized;
}
