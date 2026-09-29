import { TASK_LIST_SCHEMA_VERSION } from "../constants";
import {
  DEFAULT_MAX_TASK_TITLE_CHARS,
} from "../defaults";
import { resolveMaxTasks, TASK_LIST_POLICY } from "../policy";
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
        ...(input.purpose ? { purpose: input.purpose } : {}),
        ...(input.title ? { title: input.title } : {}),
        items: [],
      },
      warnings: [],
      reasonCodes: ["task_list_cleared", "task_list_applied"],
    });
  }

  if (input.operation.type === "replace") {
    const built = buildItems(
      input.operation.items,
      input.source,
      input.purpose,
      input.title,
      input.maxTasks,
    );
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
  const reasonCodesExtra: TaskListReasonCode[] = [];

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
      existing.title = clipTaskTitle(patch.title).title;
    }
    if (patch.detail) {
      existing.detail = patch.detail;
    }
    if (patch.status && patch.status !== existing.status) {
      const transition = validateStatusTransition(existing.status, patch.status);
      if (!transition.ok) {
        if (TASK_LIST_POLICY.statusTransitionPolicy === "reject") {
          return parsedResult({
            status: "rejected",
            warnings: [
              `Invalid status transition for "${patch.id}": ${existing.status} → ${patch.status}.`,
            ],
            reasonCodes: [
              "task_list_invalid",
              "task_list_status_transition_invalid",
            ],
          });
        }
        if (TASK_LIST_POLICY.statusTransitionPolicy === "warn") {
          warnings.push(
            `Unusual status transition for "${patch.id}": ${existing.status} → ${patch.status}.`,
          );
          reasonCodesExtra.push("task_list_status_transition_invalid");
        }
      }
      existing.status = patch.status;
    }
  }

  if (!normalizeActive(items, warnings)) {
    return parsedResult({
      status: "rejected",
      warnings,
      reasonCodes: ["task_list_invalid"],
    });
  }

  const next: TaskList = {
    schemaVersion: TASK_LIST_SCHEMA_VERSION,
    source: input.source,
    purpose: input.purpose ?? current.purpose,
    title: input.title ?? current.title,
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
    ? ["task_list_unchanged", ...reasonCodesExtra]
    : ["task_list_patched", "task_list_applied", ...reasonCodesExtra];

  return parsedResult({
    status: "applied",
    taskList: validated.data,
    warnings,
    reasonCodes: uniqueReasonCodes(reasonCodes),
  });
}

function buildItems(
  drafts: readonly TaskListDraftItem[],
  source: TaskList["source"],
  purpose?: TaskList["purpose"],
  title?: string,
  maxTasks?: number,
):
  | { ok: true; taskList: TaskList; warnings: string[] }
  | { ok: false; warnings: string[] } {
  const liveMaxTasks = resolveMaxTasks(maxTasks);
  const warnings: string[] = [];
  const used = new Set<string>();
  const items: TaskItem[] = [];

  for (const [index, draft] of drafts.slice(0, liveMaxTasks).entries()) {
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
      title: clipTaskTitle(title).title,
      status: draft.status ?? "pending",
      ...(draft.detail ? { detail: draft.detail } : {}),
    });
  }

  if (items.length < 1) {
    return { ok: false, warnings: ["Replace requires at least one task."] };
  }

  if (!normalizeActive(items, warnings)) {
    return { ok: false, warnings };
  }

  const taskList: TaskList = {
    schemaVersion: TASK_LIST_SCHEMA_VERSION,
    source,
    ...(purpose ? { purpose } : {}),
    ...(title ? { title } : {}),
    items: items.slice(0, liveMaxTasks),
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

/**
 * Enforce at-most-one active item.
 * Returns false when multipleActivePolicy is reject and the list violates it.
 */
function normalizeActive(items: TaskItem[], warnings: string[]): boolean {
  const activeIndexes = items
    .map((item, index) => (item.status === "active" ? index : -1))
    .filter((index) => index >= 0);
  if (activeIndexes.length <= TASK_LIST_POLICY.maxActiveItems) {
    return true;
  }
  if (TASK_LIST_POLICY.multipleActivePolicy === "reject") {
    warnings.push(
      `At most ${TASK_LIST_POLICY.maxActiveItems} task can be active; got ${activeIndexes.length}.`,
    );
    return false;
  }
  const keep = activeIndexes[activeIndexes.length - 1]!;
  for (const index of activeIndexes) {
    if (index !== keep) {
      items[index]!.status = "pending";
    }
  }
  warnings.push("Only one task can be active; earlier active items were queued.");
  return true;
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
      item.detail === other.detail &&
      item.sourceRef === other.sourceRef &&
      samePathList(item.write, other.write) &&
      samePathList(item.mustRead, other.mustRead) &&
      samePathList(item.affected, other.affected)
    );
  });
}

function samePathList(
  left: readonly string[] | undefined,
  right: readonly string[] | undefined,
): boolean {
  if (left === right) {
    return true;
  }
  if (!left || !right || left.length !== right.length) {
    return left === undefined && right === undefined;
  }
  return left.every((path, index) => path === right[index]);
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

/**
 * Forward progress + reopen. Terminal rows may return to pending/active;
 * done/skipped may not jump sideways into blocked without reopening.
 */
export function isValidStatusTransition(
  from: TaskItemStatus,
  to: TaskItemStatus,
): boolean {
  if (from === to) {
    return true;
  }
  const allowed: Record<TaskItemStatus, readonly TaskItemStatus[]> = {
    pending: ["active", "done", "skipped", "blocked"],
    active: ["pending", "done", "skipped", "blocked"],
    blocked: ["pending", "active", "done", "skipped"],
    done: ["pending", "active"],
    skipped: ["pending", "active"],
  };
  return allowed[from].includes(to);
}

function validateStatusTransition(
  from: TaskItemStatus,
  to: TaskItemStatus,
): { ok: boolean } {
  if (TASK_LIST_POLICY.statusTransitionPolicy === "off") {
    return { ok: true };
  }
  return { ok: isValidStatusTransition(from, to) };
}

/**
 * Soft short-title clip. Keeps path tokens intact when present so file-scoped
 * rows stay concrete after word-budget trimming.
 */
export function clipTaskTitle(
  raw: string,
  maxWords: number = TASK_LIST_POLICY.preferredTitleWords,
): { title: string; clipped: boolean } {
  const trimmed = raw.trim().replace(/\s+/g, " ").slice(0, DEFAULT_MAX_TASK_TITLE_CHARS);
  if (trimmed.length === 0) {
    return { title: trimmed, clipped: false };
  }
  const words = trimmed.split(" ");
  if (words.length <= maxWords) {
    return { title: trimmed, clipped: false };
  }
  const pathToken = words.find((word) => /\.\w{1,16}\b/.test(word) || /[/\\]/.test(word));
  const head = words.slice(0, maxWords);
  if (pathToken && !head.some((word) => word === pathToken)) {
    head[head.length - 1] = pathToken;
  }
  return {
    title: head.join(" ").slice(0, DEFAULT_MAX_TASK_TITLE_CHARS),
    clipped: true,
  };
}

function uniqueReasonCodes(
  codes: readonly TaskListReasonCode[],
): TaskListReasonCode[] {
  return [...new Set(codes)];
}
