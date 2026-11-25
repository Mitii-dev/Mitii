/**
 * Stable identifiers for the live execution task list.
 */
export const TASK_LIST_SCHEMA_VERSION = 1 as const;

export const TASK_ITEM_STATUSES = [
  "pending",
  "active",
  "done",
  "skipped",
  "blocked",
] as const;

export const TASK_LIST_SOURCES = ["plan", "agent", "user", "discovery"] as const;

export const TASK_LIST_PURPOSES = ["discovery", "execution"] as const;

export const TASK_LIST_APPLY_STATUSES = ["applied", "rejected"] as const;

export const TASK_LIST_REASON_CODES = [
  "task_list_applied",
  "task_list_replaced",
  "task_list_patched",
  "task_list_cleared",
  "task_list_derived",
  "task_list_refilled",
  "task_list_unchanged",
  "task_list_invalid",
  "task_list_empty",
  "task_list_status_transition_invalid",
  "task_list_title_clipped",
] as const;

export type TaskListReasonCodeConst =
  (typeof TASK_LIST_REASON_CODES)[number];

/** Named reason-code accessors — never build codes with string templates. */
export const TASK_LIST_REASON = {
  applied: "task_list_applied",
  replaced: "task_list_replaced",
  patched: "task_list_patched",
  cleared: "task_list_cleared",
  derived: "task_list_derived",
  refilled: "task_list_refilled",
  unchanged: "task_list_unchanged",
  invalid: "task_list_invalid",
  empty: "task_list_empty",
  statusTransitionInvalid: "task_list_status_transition_invalid",
  titleClipped: "task_list_title_clipped",
} as const satisfies Record<string, TaskListReasonCodeConst>;

export const TASK_LIST_ERROR_CODES = [
  "invalid_input",
  "invalid_task_list",
] as const;

export const TASK_LIST_MESSAGES = {
  applyInputInvalid: "Task list apply input failed schema validation.",
  deriveFailed: "Failed to derive a task list from the plan.",
  refillFailed: "Failed to refill the task list from the plan.",
} as const;

/** Ordered flow stage names (pipeline + logger). */
export const TASK_LIST_STAGES = {
  apply: "1-apply-update",
  createDiscovery: "2-create-discovery",
  deriveFromPlan: "3-derive-from-plan",
  refillFromPlan: "4-refill-from-plan",
} as const;

export type TaskListStageName =
  (typeof TASK_LIST_STAGES)[keyof typeof TASK_LIST_STAGES];

export const UPDATE_TODOS_TOOL_NAME = "update_todos" as const;

/** Common model misspellings / aliases accepted by Agent Engine. */
export const UPDATE_TODOS_TOOL_ALIASES = [
  "update_todo",
  "update_todo_list",
  "task_list_update",
  "update_task_list",
] as const;
