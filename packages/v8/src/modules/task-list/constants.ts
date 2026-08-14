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

export const TASK_LIST_SOURCES = ["plan", "agent", "user"] as const;

export const TASK_LIST_APPLY_STATUSES = ["applied", "rejected"] as const;

export const TASK_LIST_REASON_CODES = [
  "task_list_applied",
  "task_list_replaced",
  "task_list_patched",
  "task_list_cleared",
  "task_list_derived",
  "task_list_unchanged",
  "task_list_invalid",
  "task_list_empty",
] as const;

export const TASK_LIST_ERROR_CODES = [
  "invalid_input",
  "invalid_task_list",
] as const;

export const UPDATE_TODOS_TOOL_NAME = "update_todos" as const;

/** Common model misspellings / aliases accepted by Agent Engine. */
export const UPDATE_TODOS_TOOL_ALIASES = [
  "update_todo",
  "update_todo_list",
  "task_list_update",
  "update_task_list",
] as const;
