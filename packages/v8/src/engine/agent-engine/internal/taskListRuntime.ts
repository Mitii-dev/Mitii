import type { PlanArtifact } from "../../../modules/planning";
import {
  TASK_LIST_POLICY,
  TaskListPipeline,
  collectCompletedTaskPaths,
  extractDiagnosticCodeHint,
  itemMentionsAnyPath,
  taskListProgress,
  taskItemPaths,
  taskPathsMatch,
} from "../../../modules/task-list";
import type {
  TaskList,
} from "../../../modules/task-list";
import type { ToolResult } from "../../tool-runtime";
import type { VerificationDiagnostic } from "../../../modules/verification";

import type { TaskListRef } from "./updateTodosRuntime";
import {
  ensureCompletedPlanStepIds,
  recordCompletedPlanSteps,
} from "./updateTodosRuntime";

const pipeline = new TaskListPipeline();

export {
  UPDATE_TODOS_TOOL_DEFINITION,
  type TaskListRef,
  ensureCompletedPlanStepIds,
  recordCompletedPlanSteps,
  planProgressOf,
  attachTaskListTool,
  isUpdateTodosTool,
  canonicalizeUpdateTodosToolName,
  shouldSeedTaskListFromPlan,
  seedTaskListFromPlan,
  applyUpdateTodosArguments,
  normalizeTodoStatus,
  buildUpdateTodosToolResult,
} from "./updateTodosRuntime";

export function maybeAutoAdvanceTaskList(params: {
  enabled?: boolean;
  current?: TaskList;
  preToolActiveId?: string;
  toolStatus: ToolResult["status"];
  isMutatingTool: boolean;
  /** When false, skip advancing (budget already used this turn). */
  allowAdvance?: boolean;
  /** Paths written by this mutation; matching checklist rows complete together. */
  changedFiles?: readonly string[];
  /** Overflow plan steps stream into the live list after rows complete. */
  plan?: PlanArtifact;
  maxTasks?: number;
  /** Engine notebook of finished plan step ids. */
  taskListRef?: TaskListRef;
}): {
  advanced: boolean;
  refilled?: boolean;
  taskList?: TaskList;
  warnings: string[];
  completedStepIds?: string[];
} {
  if (!(params.enabled ?? TASK_LIST_POLICY.autoAdvanceOnMutationSuccess)) {
    return { advanced: false, warnings: [] };
  }
  if (!params.current || params.current.items.length === 0) {
    return { advanced: false, warnings: [] };
  }
  if (params.toolStatus !== "succeeded" || !params.isMutatingTool) {
    return { advanced: false, warnings: [] };
  }
  if (params.allowAdvance === false) {
    return { advanced: false, warnings: [] };
  }

  const changedFiles = (params.changedFiles ?? []).filter(Boolean);
  if (changedFiles.length === 0) {
    // No path evidence — do not invent completion for the active row.
    return { advanced: false, warnings: [] };
  }

  const matching = params.current.items.filter(
    (item) =>
      item.status !== "done" &&
      item.status !== "skipped" &&
      isMutationAutoAdvanceEligible(item) &&
      itemMentionsAnyPath(item, changedFiles) &&
      // Diagnostic-coded Change batches wait for verification evidence.
      extractDiagnosticCodeHint(`${item.title} ${item.detail ?? ""}`) ===
        undefined,
  );

  if (matching.length === 0) {
    return { advanced: false, warnings: [] };
  }

  const doneIds = new Set(matching.map((item) => item.id));
  const nextPending = params.current.items.find(
    (item) =>
      item.status === "pending" &&
      !doneIds.has(item.id) &&
      isMutationAutoAdvanceEligible(item),
  );
  const patchItems = [
    ...matching.map((item) => ({ id: item.id, status: "done" as const })),
    ...(nextPending ? [{ id: nextPending.id, status: "active" as const }] : []),
  ];
  const result = pipeline.apply({
    schemaVersion: 1,
    current: params.current,
    source: params.current.source,
    operation: {
      type: "patch",
      items: patchItems,
    },
  });
  if (result.status !== "applied" || !result.taskList) {
    return { advanced: false, warnings: result.warnings };
  }
  const completedStepIds = params.taskListRef
    ? recordCompletedPlanSteps(params.taskListRef, matching)
    : matching.map((item) => item.sourceRef ?? item.id);
  return withPlanRefill({
    advanced: result.reasonCodes.includes("task_list_patched"),
    taskList: result.taskList,
    warnings: result.warnings,
    plan: params.plan,
    maxTasks: params.maxTasks,
    taskListRef: params.taskListRef,
    completedStepIds,
  });
}

/**
 * After verification, mark diagnostic-coded Change rows done when their
 * error class is gone on their write paths. Never ticks Verify process rows
 * from a patch — only from cleared diagnostics evidence.
 */
export function completePlanStepsFromDiagnostics(params: {
  current?: TaskList;
  plan?: PlanArtifact;
  maxTasks?: number;
  taskListRef: TaskListRef;
  diagnostics?: readonly VerificationDiagnostic[];
  /** When true, new errors appeared — do not complete diagnostic batches. */
  newErrorsIntroduced?: boolean;
}): {
  advanced: boolean;
  refilled?: boolean;
  taskList?: TaskList;
  warnings: string[];
  completedStepIds: string[];
} {
  if (!params.current || params.current.items.length === 0) {
    return { advanced: false, warnings: [], completedStepIds: [] };
  }
  if (params.newErrorsIntroduced) {
    return {
      advanced: false,
      warnings: [],
      completedStepIds: [],
      taskList: params.current,
    };
  }

  const remainingErrors = (params.diagnostics ?? []).filter(
    (diagnostic) => diagnostic.severity === "error",
  );
  const toComplete = params.current.items.filter((item) => {
    if (item.status === "done" || item.status === "skipped") {
      return false;
    }
    if (!isMutationAutoAdvanceEligible(item)) {
      return false;
    }
    const code = extractDiagnosticCodeHint(`${item.title} ${item.detail ?? ""}`);
    if (!code) {
      return false;
    }
    const owned = taskItemPaths(item);
    if (owned.length === 0) {
      return false;
    }
    const stillFailing = remainingErrors.some((diagnostic) => {
      const diagnosticCode = normalizeDiagnosticCode(diagnostic.code);
      if (diagnosticCode !== code) {
        return false;
      }
      return owned.some((path) => taskPathsMatch(path, diagnostic.path));
    });
    return !stillFailing;
  });

  if (toComplete.length === 0) {
    return {
      advanced: false,
      warnings: [],
      completedStepIds: [],
      taskList: params.current,
    };
  }

  const doneIds = new Set(toComplete.map((item) => item.id));
  const nextPending = params.current.items.find(
    (item) =>
      item.status === "pending" &&
      !doneIds.has(item.id) &&
      isMutationAutoAdvanceEligible(item),
  );
  const patchItems = [
    ...toComplete.map((item) => ({ id: item.id, status: "done" as const })),
    ...(nextPending ? [{ id: nextPending.id, status: "active" as const }] : []),
  ];
  const result = pipeline.apply({
    schemaVersion: 1,
    current: params.current,
    source: params.current.source,
    operation: {
      type: "patch",
      items: patchItems,
    },
  });
  if (result.status !== "applied" || !result.taskList) {
    return {
      advanced: false,
      warnings: result.warnings,
      completedStepIds: [],
    };
  }
  const completedStepIds = recordCompletedPlanSteps(
    params.taskListRef,
    toComplete,
  );
  return {
    ...withPlanRefill({
      advanced: true,
      taskList: result.taskList,
      warnings: result.warnings,
      plan: params.plan,
      maxTasks: params.maxTasks,
      taskListRef: params.taskListRef,
      completedStepIds,
    }),
    completedStepIds,
  };
}

function normalizeDiagnosticCode(code: string | undefined): string | undefined {
  if (!code) {
    return undefined;
  }
  const trimmed = code.trim();
  const ts = trimmed.match(/^TS(\d{4})$/i);
  if (ts?.[1]) {
    return `TS${ts[1]}`;
  }
  const bare = trimmed.match(/^(\d{4})$/);
  if (bare?.[1]) {
    return `TS${bare[1]}`;
  }
  return trimmed.toUpperCase();
}

function withPlanRefill(params: {
  advanced: boolean;
  taskList: TaskList;
  warnings: string[];
  plan?: PlanArtifact;
  maxTasks?: number;
  taskListRef?: TaskListRef;
  completedStepIds?: string[];
}): {
  advanced: boolean;
  refilled?: boolean;
  taskList?: TaskList;
  warnings: string[];
  completedStepIds?: string[];
} {
  const refilled = maybeRefillTaskListFromPlan({
    current: params.taskList,
    plan: params.plan,
    maxTasks: params.maxTasks,
    completedPlanStepIds: params.taskListRef
      ? ensureCompletedPlanStepIds(params.taskListRef)
      : undefined,
  });
  return {
    advanced: params.advanced,
    ...(refilled.refilled ? { refilled: true } : {}),
    taskList: refilled.taskList ?? params.taskList,
    warnings: params.warnings,
    ...(params.completedStepIds && params.completedStepIds.length > 0
      ? { completedStepIds: params.completedStepIds }
      : {}),
  };
}

export function maybeRefillTaskListFromPlan(params: {
  current?: TaskList;
  plan?: PlanArtifact;
  maxTasks?: number;
  completedPlanStepIds?: readonly string[];
}): { refilled: boolean; taskList?: TaskList } {
  if (!params.current || !params.plan) {
    return { refilled: false, taskList: params.current };
  }
  const result = pipeline.refillFromPlan(
    params.current,
    params.plan,
    params.maxTasks,
    params.completedPlanStepIds,
  );
  if (
    result.status !== "applied" ||
    !result.taskList ||
    !result.reasonCodes.includes("task_list_refilled")
  ) {
    return { refilled: false, taskList: params.current };
  }
  return { refilled: true, taskList: result.taskList };
}

/**
 * Before a verification-repair loop, stream overflow plan batches if the live
 * list is all terminal, then activate the next concrete pending batch.
 */
export function prepareRepairWorkingSet(params: {
  current?: TaskList;
  plan?: PlanArtifact;
  maxTasks?: number;
  completedPlanStepIds?: readonly string[];
}): {
  taskList?: TaskList;
  activated: boolean;
  refilled: boolean;
  activeItem?: TaskList["items"][number];
} {
  if (!params.current || params.current.items.length === 0) {
    return { taskList: params.current, activated: false, refilled: false };
  }
  if (params.current.purpose === "discovery") {
    return { taskList: params.current, activated: false, refilled: false };
  }

  let taskList = params.current;
  let refilled = false;

  const allTerminal = taskList.items.every(
    (item) => item.status === "done" || item.status === "skipped",
  );
  if (allTerminal && params.plan) {
    const refillResult = maybeRefillTaskListFromPlan({
      current: taskList,
      plan: params.plan,
      maxTasks: params.maxTasks,
      completedPlanStepIds: params.completedPlanStepIds,
    });
    if (refillResult.refilled && refillResult.taskList) {
      taskList = refillResult.taskList;
      refilled = true;
    }
  }

  const activeEligible = taskList.items.filter(
    (item) =>
      item.status === "active" && isMutationAutoAdvanceEligible(item),
  );
  if (activeEligible.length === 1) {
    return {
      taskList,
      activated: false,
      refilled,
      activeItem: activeEligible[0],
    };
  }

  const nextPending = taskList.items.find(
    (item) =>
      item.status === "pending" && isMutationAutoAdvanceEligible(item),
  );
  if (!nextPending) {
    const fallbackActive = taskList.items.find((item) => item.status === "active");
    return {
      taskList,
      activated: false,
      refilled,
      ...(fallbackActive ? { activeItem: fallbackActive } : {}),
    };
  }

  const demoteActive = taskList.items
    .filter((item) => item.status === "active")
    .map((item) => ({ id: item.id, status: "pending" as const }));
  const result = pipeline.apply({
    schemaVersion: 1,
    current: taskList,
    source: taskList.source,
    operation: {
      type: "patch",
      items: [...demoteActive, { id: nextPending.id, status: "active" }],
    },
  });
  if (result.status !== "applied" || !result.taskList) {
    return { taskList, activated: false, refilled };
  }
  const activeItem = result.taskList.items.find((item) => item.status === "active");
  return {
    taskList: result.taskList,
    activated: true,
    refilled,
    ...(activeItem ? { activeItem } : {}),
  };
}

/** Mutation success may only complete concrete change-like checklist rows. */
export function isMutationAutoAdvanceEligible(item: {
  title: string;
  detail?: string;
  write?: readonly string[];
  mustRead?: readonly string[];
  affected?: readonly string[];
}): boolean {
  const title = item.title.trim();
  if (TASK_LIST_POLICY.autoAdvanceBlockedTitle.test(title)) {
    return false;
  }
  if (TASK_LIST_POLICY.deferredIntent.test(title)) {
    return false;
  }
  const hint = `${title} ${item.detail ?? ""} ${taskItemPaths(item).join(" ")}`;
  // Package-wide mega-objectives without a file must not burn through on one patch.
  return TASK_LIST_POLICY.autoAdvanceConcreteFileHint.test(hint);
}

export { upsertTrailingWorkingSet } from "./workingSetRuntime";

export { collectCompletedTaskPaths };

export function progressOf(taskList: TaskList) {
  return taskListProgress(taskList);
}

