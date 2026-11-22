/**
 * Medium/large invariant: plan-derived task list must be non-empty and concrete.
 * One seed-informed recovery of Change targetRefs is allowed; never synthesize
 * an executable row from seed alone when the plan has no recoverable steps.
 */
import { TaskListPipeline } from "../../../../modules/task-list";
import type { PlanArtifact } from "../../../../modules/planning";
import type { TaskList } from "../../../../modules/task-list";

import type { ExecutionSeed } from "./resolve";
import { recoverPlanTargetsFromSeed } from "./recoverPlanTargetsFromSeed";
import { applyExecutionSeedToTaskList } from "./applyExecutionSeedToTaskList";

export type EnsureConcreteTaskListResult = {
  plan: PlanArtifact;
  taskList: TaskList | undefined;
  concrete: boolean;
  recovered: boolean;
  seedBound: boolean;
};

export function ensureConcreteTaskListFromPlan(params: {
  plan: PlanArtifact;
  seed?: ExecutionSeed;
  maxTasks?: number;
  /** Allow one seed→targetRefs recovery before declaring non-concrete. */
  allowSeedRecovery?: boolean;
}): EnsureConcreteTaskListResult {
  const pipeline = new TaskListPipeline();
  let plan = params.plan;
  let recovered = false;

  let derived = pipeline.deriveFromPlan(plan, params.maxTasks);
  let taskList =
    derived.status === "applied" ? derived.taskList : undefined;

  if (
    !hasConcreteWrite(taskList) &&
    params.allowSeedRecovery !== false
  ) {
    const recovery = recoverPlanTargetsFromSeed({
      plan,
      seed: params.seed,
    });
    if (recovery.recovered) {
      recovered = true;
      plan = recovery.plan;
      derived = pipeline.deriveFromPlan(plan, params.maxTasks);
      taskList =
        derived.status === "applied" ? derived.taskList : undefined;
    }
  }

  let seedBound = false;
  if (taskList) {
    const bound = applyExecutionSeedToTaskList({
      taskList,
      seed: params.seed,
    });
    if (bound.applied && bound.taskList) {
      taskList = bound.taskList;
      seedBound = true;
    }
  }

  return {
    plan,
    taskList,
    concrete: hasConcreteWrite(taskList),
    recovered,
    seedBound,
  };
}

function hasConcreteWrite(taskList: TaskList | undefined): boolean {
  return (taskList?.items ?? []).some(
    (item) => (item.write?.length ?? 0) > 0,
  );
}
