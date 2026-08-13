import { TASK_LIST_SCHEMA_VERSION } from "../constants";
import {
  DEFAULT_MAX_TASK_TITLE_CHARS,
  DEFAULT_MAX_TASKS,
} from "../defaults";
import { TASK_LIST_POLICY } from "../policy";
import type {
  TaskItem,
  TaskItemStatus,
  TaskList,
  TaskListApplyInput,
  TaskListApplyResult,
  TaskListDraftItem,
  TaskListReasonCode,
} from "../contracts";
import { taskListApplyResultSchema, taskListSchema } from "../contracts";

/**
 * Apply a replace/patch/clear onto the current live task list.
 * Never stamps remaining items done.
 */
export function applyTaskListUpdate(
  input: TaskListApplyInput,
): TaskListApplyResult {
  if (input.operation.type === "clear") {
    return parsedResult({
      status: "applied",
      taskList: {
        schemaVersion: TASK_LIST_SCHEMA_VERSION,
        source: input.source,
        items: [],
      },
      warnings: [],
      reasonCodes: ["task_list_cleared", "task_list_applied"],
    });
  }

  if (input.operation.type === "replace") {
    const built = buildItems(input.operation.items, input.source);
    if (!built.ok) {
      return parsedResult({
        status: "rejected",
        warnings: built.warnings,
        reasonCodes: ["task_list_invalid"],
      });
    }
    return parsedResult({
      status: "applied",
      taskList: built.taskList,
      warnings: built.warnings,
      reasonCodes: ["task_list_replaced", "task_list_applied"],
    });
  }

  const current = input.current;
  if (!current || current.items.length === 0) {
    return parsedResult({
      status: "rejected",
      warnings: ["Cannot patch an empty task list. Use replace to create one."],
      reasonCodes: ["task_list_invalid", "task_list_empty"],
    });
  }

  const items = current.items.map((item) => ({ ...item }));
  const byId = new Map(items.map((item) => [item.id, item]));
  const warnings: string[] = [];

  for (const patch of input.operation.items) {
    const existing = byId.get(patch.id);
    if (!existing) {
      return parsedResult({
        status: "rejected",
        warnings: [`Unknown task id "${patch.id}".`],
        reasonCodes: ["task_list_invalid"],
      });
    }
    if (patch.title) {
      existing.title = patch.title.slice(0, DEFAULT_MAX_TASK_TITLE_CHARS);
    }
    if (patch.detail) {
      existing.detail = patch.detail;
    }
    if (patch.status) {
      existing.status = patch.status;
    }
  }

  normalizeActive(items, warnings);

  const next: TaskList = {
    schemaVersion: TASK_LIST_SCHEMA_VERSION,
    source: input.source,
    title: current.title,
    items,
  };

  const validated = taskListSchema.safeParse(next);
  if (!validated.success) {
    return parsedResult({
      status: "rejected",
      warnings: validated.error.issues.map((issue) => issue.message),
      reasonCodes: ["task_list_invalid"],
    });
  }

  const unchanged = sameList(current, validated.data);
  const reasonCodes: TaskListReasonCode[] = unchanged
    ? ["task_list_unchanged"]
    : ["task_list_patched", "task_list_applied"];

  return parsedResult({
    status: unchanged ? "applied" : "applied",
    taskList: validated.data,
    warnings,
    reasonCodes,
  });
}

function buildItems(
  drafts: readonly TaskListDraftItem[],
  source: TaskList["source"],
):
  | { ok: true; taskList: TaskList; warnings: string[] }
  | { ok: false; warnings: string[] } {
  const warnings: string[] = [];
  const used = new Set<string>();
  const items: TaskItem[] = [];

  for (const [index, draft] of drafts
    .slice(0, TASK_LIST_POLICY.maxTasks)
    .entries()) {
    const title = draft.title.trim().slice(0, DEFAULT_MAX_TASK_TITLE_CHARS);
    if (!title) {
      warnings.push(`Skipped empty task title at index ${index}.`);
      continue;
    }
    let id = slugId(draft.id ?? `task-${index + 1}`);
    if (used.has(id)) {
      id = `${id}-${index + 1}`;
    }
    used.add(id);
    items.push({
      id,
      title,
      status: draft.status ?? "pending",
      ...(draft.detail ? { detail: draft.detail } : {}),
    });
  }

  if (items.length < 1) {
    return { ok: false, warnings: ["Replace requires at least one task."] };
  }

  normalizeActive(items, warnings);

  const taskList: TaskList = {
    schemaVersion: TASK_LIST_SCHEMA_VERSION,
    source,
    items: items.slice(0, DEFAULT_MAX_TASKS),
  };
  const validated = taskListSchema.safeParse(taskList);
  if (!validated.success) {
    return {
      ok: false,
      warnings: validated.error.issues.map((issue) => issue.message),
    };
  }
  return { ok: true, taskList: validated.data, warnings };
}

function normalizeActive(items: TaskItem[], warnings: string[]): void {
  const activeIndexes = items
    .map((item, index) => (item.status === "active" ? index : -1))
    .filter((index) => index >= 0);
  if (activeIndexes.length <= TASK_LIST_POLICY.maxActiveItems) {
    return;
  }
  const keep = activeIndexes[activeIndexes.length - 1]!;
  for (const index of activeIndexes) {
    if (index !== keep) {
      items[index]!.status = "pending";
    }
  }
  warnings.push("Only one task can be active; earlier active items were queued.");
}

function slugId(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return slug.length > 0 ? slug : "task";
}

function sameList(left: TaskList, right: TaskList): boolean {
  if (left.items.length !== right.items.length) return false;
  return left.items.every((item, index) => {
    const other = right.items[index];
    return (
      other !== undefined &&
      item.id === other.id &&
      item.title === other.title &&
      item.status === other.status &&
      item.detail === other.detail
    );
  });
}

function parsedResult(value: {
  status: TaskListApplyResult["status"];
  taskList?: TaskList;
  warnings: string[];
  reasonCodes: TaskListReasonCode[];
}): TaskListApplyResult {
  return taskListApplyResultSchema.parse({
    schemaVersion: TASK_LIST_SCHEMA_VERSION,
    status: value.status,
    taskList: value.taskList,
    warnings: value.warnings,
    reasonCodes: value.reasonCodes,
  });
}

export function isTerminalTaskStatus(status: TaskItemStatus): boolean {
  return status === "done" || status === "skipped";
}
