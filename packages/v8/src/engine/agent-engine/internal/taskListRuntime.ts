import type { ModelMessage, ModelToolDefinition } from "../../../modules/model-gateway";
import type { PlanArtifact } from "../../../modules/planning";
import {
  MAX_TASKS_CAP,
  TASK_LIST_POLICY,
  TaskListPipeline,
  UPDATE_TODOS_TOOL_ALIASES,
  UPDATE_TODOS_TOOL_NAME,
  WORKING_SET_MARKER,
  collectCompletedTaskPaths,
  collectConcretePlanStepCandidates,
  extractDiagnosticCodeHint,
  itemMentionsAnyPath,
  taskListApplyInputSchema,
  taskListProgress,
  taskItemPaths,
  taskPathsMatch,
} from "../../../modules/task-list";
import type {
  TaskList,
  TaskListApplyInput,
  TaskListSource,
} from "../../../modules/task-list";
import type { ToolResult } from "../../tool-runtime";
import { TOOL_RUNTIME_SCHEMA_VERSION, toolResultSchema } from "../../tool-runtime";
import type { VerificationDiagnostic } from "../../../modules/verification";
import {
  serializeRecoverabilityWorkingSet,
  type RecoverabilityWorkingSetInput,
} from "../actions/serializeRecoverabilityWorkingSet";
import type { RunEvidence } from "../contracts";

const UPDATE_TODOS_ITEM_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    id: {
      type: "string",
      description:
        "Stable id. Prefer plan step ids when the list came from a plan.",
    },
    title: {
      type: "string",
      description:
        "Short concrete work title (file, failure, or user-visible behavior).",
    },
    content: {
      type: "string",
      description: "Alias for title (accepted for compatibility).",
    },
    status: {
      type: "string",
      enum: [
        "pending",
        "active",
        "done",
        "skipped",
        "blocked",
        "in_progress",
        "completed",
        "todo",
      ],
      description:
        "At most one item may be active. Use pending → active → done for progress. Aliases: in_progress→active, completed→done.",
    },
    detail: { type: "string" },
  },
} as const;

export const UPDATE_TODOS_TOOL_DEFINITION: ModelToolDefinition = {
  name: UPDATE_TODOS_TOOL_NAME,
  description:
    `Create or update the live working checklist for this run (max ${MAX_TASKS_CAP} items; often 8 on small windows). ` +
    "If this is a multi-step run and the list is empty after the first read/diagnose tool turn, " +
    "call update_todos with type=replace and concrete titles naming a file, failure, or user-visible behavior. " +
    "Pass checklist rows as items (preferred) or todos; each row needs title (or content). " +
    "Aliases accepted: update_todo, update_todo_list, task_list_update, update_task_list. " +
    "Keep exactly one item active. Before finishing a slice, patch the active item to done and the next pending item to active. " +
    "Do not copy Discover/Change/Verify process labels or skill playbook bullets into titles. " +
    "If a plan-derived list is still process-shaped, replace it; otherwise prefer patch by id (stable ids / sourceRef). " +
    "Use clear to drop the list. Do not mark remaining items done just because the turn is ending. " +
    "Skip this tool for trivial single-step work.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      type: {
        type: "string",
        enum: ["replace", "patch", "clear"],
        description:
          "replace creates/replaces the list, patch updates items by id (preferred for progress), clear removes it.",
      },
      items: {
        type: "array",
        maxItems: MAX_TASKS_CAP,
        description:
          "Checklist items. Prefer concrete file/failure titles over vague process labels.",
        items: UPDATE_TODOS_ITEM_SCHEMA,
      },
      todos: {
        type: "array",
        maxItems: MAX_TASKS_CAP,
        description: "Alias for items (accepted for compatibility).",
        items: UPDATE_TODOS_ITEM_SCHEMA,
      },
    },
    required: ["type"],
  },
};

export interface TaskListRef {
  current?: TaskList;
  maxTasks?: number;
  /**
   * Durable finished plan step ids (sourceRef). Survives desk refill drops so
   * completed Change/Verify rows never return as pending.
   */
  completedPlanStepIds?: string[];
}

export function ensureCompletedPlanStepIds(ref: TaskListRef): string[] {
  if (!ref.completedPlanStepIds) {
    ref.completedPlanStepIds = [];
  }
  return ref.completedPlanStepIds;
}

export function recordCompletedPlanSteps(
  ref: TaskListRef,
  items: readonly { id: string; sourceRef?: string }[],
): string[] {
  const notebook = ensureCompletedPlanStepIds(ref);
  const added: string[] = [];
  for (const item of items) {
    const stepId = item.sourceRef ?? item.id;
    if (stepId.length === 0 || notebook.includes(stepId)) {
      continue;
    }
    notebook.push(stepId);
    added.push(stepId);
  }
  return added;
}

/** PLAN n/total for hosts — independent of the live 8-slot desk. */
export function planProgressOf(params: {
  plan?: PlanArtifact;
  completedPlanStepIds?: readonly string[];
  evidence?: RunEvidence;
}): {
  planCompletedCount: number;
  planTotalCount: number;
  completedStepIds: string[];
} {
  const fromPlan = params.plan
    ? collectConcretePlanStepCandidates(params.plan).map(
        (candidate) => candidate.step.id,
      )
    : (params.evidence?.plan?.steps ?? []).map((step) => step.id);
  const totalIds = [...new Set(fromPlan.filter((id) => id.length > 0))];
  const completed = [
    ...new Set(
      (params.completedPlanStepIds ?? []).filter((id) =>
        totalIds.length === 0 ? id.length > 0 : totalIds.includes(id),
      ),
    ),
  ];
  return {
    planCompletedCount: completed.length,
    planTotalCount: totalIds.length,
    completedStepIds: completed,
  };
}

const pipeline = new TaskListPipeline();

export function attachTaskListTool(params: {
  mode: string;
  tools: ModelToolDefinition[];
}): ModelToolDefinition[] {
  if (params.mode !== "agent" || params.tools.length === 0) {
    return params.tools;
  }
  if (params.tools.some((tool) => tool.name === UPDATE_TODOS_TOOL_NAME)) {
    return params.tools;
  }
  return [...params.tools, UPDATE_TODOS_TOOL_DEFINITION];
}

export function isUpdateTodosTool(name: string): boolean {
  if (name === UPDATE_TODOS_TOOL_NAME) return true;
  return (UPDATE_TODOS_TOOL_ALIASES as readonly string[]).includes(name);
}

/** Normalize model aliases to the canonical tool name. */
export function canonicalizeUpdateTodosToolName(name: string): string {
  return isUpdateTodosTool(name) ? UPDATE_TODOS_TOOL_NAME : name;
}

export function shouldSeedTaskListFromPlan(params: {
  mode: string;
  planningDepth?: "none" | "internal" | "visible";
  planSource?: "host_carry" | "resume_approval";
}): boolean {
  if (params.mode === "plan") {
    return true;
  }
  if (params.mode !== "agent") {
    return false;
  }
  return (
    params.planningDepth === "visible" ||
    params.planSource === "host_carry" ||
    params.planSource === "resume_approval"
  );
}

export function seedTaskListFromPlan(params: {
  mode: string;
  plan?: PlanArtifact;
  planningDepth?: "none" | "internal" | "visible";
  planSource?: "host_carry" | "resume_approval";
  taskListRef: TaskListRef;
  resetExisting?: boolean;
}): { seeded: boolean; source: TaskListSource } {
  if (params.mode !== "plan" && params.mode !== "agent") {
    params.taskListRef.current = undefined;
    return { seeded: false, source: "plan" };
  }
  if (params.resetExisting) {
    params.taskListRef.current = undefined;
  }
  const current = params.taskListRef.current;
  const currentIsDiscovery =
    current?.purpose === "discovery" || current?.source === "discovery";
  if (currentIsDiscovery) {
    params.taskListRef.current = undefined;
  }
  if (params.taskListRef.current && params.taskListRef.current.items.length > 0) {
    return { seeded: false, source: params.taskListRef.current.source };
  }
  if (
    !params.plan ||
    !shouldSeedTaskListFromPlan({
      mode: params.mode,
      planningDepth: params.planningDepth,
      planSource: params.planSource,
    })
  ) {
    return { seeded: false, source: "plan" };
  }
  const derived = pipeline.deriveFromPlan(params.plan, params.taskListRef.maxTasks);
  if (derived.status !== "applied" || !derived.taskList) {
    return { seeded: false, source: "plan" };
  }
  params.taskListRef.current = derived.taskList;
  return { seeded: true, source: "plan" };
}

export function applyUpdateTodosArguments(params: {
  current?: TaskList;
  argumentsValue: unknown;
  maxTasks?: number;
}):
  | { ok: true; taskList?: TaskList; warnings: string[] }
  | { ok: false; message: string } {
  const raw =
    params.argumentsValue && typeof params.argumentsValue === "object"
      ? (params.argumentsValue as Record<string, unknown>)
      : {};
  const type = raw.type;
  if (type !== "replace" && type !== "patch" && type !== "clear") {
    return {
      ok: false,
      message: 'update_todos requires type "replace", "patch", or "clear".',
    };
  }

  const items = resolveTodoItemRows(raw);
  if (type !== "clear" && items.length === 0) {
    return {
      ok: false,
      message:
        'update_todos replace/patch requires a non-empty "items" (or "todos") array. ' +
        "Each item needs title (or content).",
    };
  }

  const inputCandidate: TaskListApplyInput = {
    schemaVersion: 1,
    current: params.current,
    source: "agent",
    ...(params.maxTasks !== undefined ? { maxTasks: params.maxTasks } : {}),
    operation:
      type === "clear"
        ? { type: "clear" }
        : type === "replace"
          ? {
              type: "replace",
              items: items.map((item) => mapReplaceDraft(item)),
            }
          : {
              type: "patch",
              items: items.map((item) => mapPatchDraft(item)),
            },
  };

  const parsed = taskListApplyInputSchema.safeParse(inputCandidate);
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues.map((issue) => issue.message).join("; "),
    };
  }
  const result = pipeline.apply(parsed.data);
  if (result.status !== "applied") {
    return {
      ok: false,
      message: result.warnings.join("; ") || "Task list update rejected.",
    };
  }
  return {
    ok: true,
    taskList: result.taskList,
    warnings: result.warnings,
  };
}

function resolveTodoItemRows(raw: Record<string, unknown>): unknown[] {
  if (Array.isArray(raw.items) && raw.items.length > 0) {
    return raw.items;
  }
  if (Array.isArray(raw.todos) && raw.todos.length > 0) {
    return raw.todos;
  }
  if (Array.isArray(raw.items)) {
    return raw.items;
  }
  if (Array.isArray(raw.todos)) {
    return raw.todos;
  }
  return [];
}

function mapReplaceDraft(item: unknown): {
  id?: string;
  title: string;
  status?: TaskList["items"][number]["status"];
  detail?: string;
} {
  const record = asRecord(item);
  const title = resolveTodoTitle(record);
  const status = normalizeTodoStatus(record.status);
  return {
    ...(typeof record.id === "string" ? { id: record.id } : {}),
    title: title ?? "Untitled",
    ...(status ? { status } : {}),
    ...(typeof record.detail === "string" ? { detail: record.detail } : {}),
  };
}

function mapPatchDraft(item: unknown): {
  id: string;
  title?: string;
  status?: TaskList["items"][number]["status"];
  detail?: string;
} {
  const record = asRecord(item);
  const title = resolveTodoTitle(record);
  const status = normalizeTodoStatus(record.status);
  return {
    id: typeof record.id === "string" ? record.id : "",
    ...(title ? { title } : {}),
    ...(status ? { status } : {}),
    ...(typeof record.detail === "string" ? { detail: record.detail } : {}),
  };
}

function resolveTodoTitle(record: Record<string, unknown>): string | undefined {
  for (const key of ["title", "content", "text"] as const) {
    const value = record[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  }
  return undefined;
}

/** Map common model status aliases onto the task-list contract. */
export function normalizeTodoStatus(
  value: unknown,
): TaskList["items"][number]["status"] | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const key = value.trim().toLowerCase().replace(/-/g, "_");
  switch (key) {
    case "pending":
    case "todo":
    case "not_started":
      return "pending";
    case "active":
    case "in_progress":
    case "doing":
      return "active";
    case "done":
    case "completed":
    case "complete":
      return "done";
    case "skipped":
    case "cancelled":
    case "canceled":
      return "skipped";
    case "blocked":
      return "blocked";
    default:
      return undefined;
  }
}

export function buildUpdateTodosToolResult(params: {
  callId: string;
  status: "succeeded" | "rejected";
  reasonCode?: "invalid_arguments";
  taskList?: TaskList;
  warnings: string[];
}): ToolResult {
  const now = new Date().toISOString();
  const output = params.taskList
    ? {
        taskList: params.taskList,
        ...taskListProgress(params.taskList),
      }
    : undefined;
  return toolResultSchema.parse({
    schemaVersion: TOOL_RUNTIME_SCHEMA_VERSION,
    callId: params.callId,
    toolName: UPDATE_TODOS_TOOL_NAME,
    status: params.status,
    ...(params.reasonCode ? { reasonCode: params.reasonCode } : {}),
    output,
    truncated: false,
    redacted: false,
    durationMs: 0,
    bytesProduced: 0,
    warnings: params.warnings,
    audit: {
      callId: params.callId,
      toolName: UPDATE_TODOS_TOOL_NAME,
      startedAt: now,
      endedAt: now,
      status: params.status,
      ...(params.reasonCode ? { reasonCode: params.reasonCode } : {}),
      inputPreview: "update_todos",
      outputPreview: output
        ? `${output.completedCount}/${output.totalCount}`
        : undefined,
      bytesProduced: 0,
      durationMs: 0,
      truncated: false,
      redacted: false,
    },
  });
}

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

/**
 * Keep a live recoverability block at the end of the loop transcript so
 * compaction can drop it and the next turn can restore it without rewriting
 * the system prefix.
 */
export function upsertTrailingWorkingSet(
  messages: ModelMessage[],
  input?: RecoverabilityWorkingSetInput,
): void {
  const content = serializeRecoverabilityWorkingSet(input ?? {});
  const existing = messages.findIndex(
    (message) =>
      message.role === "user" && message.content.includes(WORKING_SET_MARKER),
  );
  if (!content) {
    if (existing >= 0) {
      messages.splice(existing, 1);
    }
    return;
  }
  const next: ModelMessage = { role: "user", content };
  if (existing >= 0) {
    messages.splice(existing, 1);
  }
  messages.push(next);
}

export { collectCompletedTaskPaths };

export function progressOf(taskList: TaskList) {
  return taskListProgress(taskList);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}
