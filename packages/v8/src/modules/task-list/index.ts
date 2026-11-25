/**
 * Task List public surface.
 *
 * Prefer `TaskListPipeline` for apply / derive / refill / discovery.
 */

export {
  TASK_LIST_SCHEMA_VERSION,
  TASK_ITEM_STATUSES,
  TASK_LIST_SOURCES,
  TASK_LIST_PURPOSES,
  TASK_LIST_APPLY_STATUSES,
  TASK_LIST_REASON_CODES,
  TASK_LIST_REASON,
  TASK_LIST_ERROR_CODES,
  TASK_LIST_MESSAGES,
  TASK_LIST_STAGES,
  UPDATE_TODOS_TOOL_NAME,
  UPDATE_TODOS_TOOL_ALIASES,
} from "./constants";
export type {
  TaskListReasonCodeConst,
  TaskListStageName,
} from "./constants";

export {
  DEFAULT_MAX_TASKS,
  MAX_TASKS_CAP,
  DEFAULT_MIN_TASKS,
  DEFAULT_MAX_TASK_TITLE_CHARS,
  DEFAULT_MAX_TASK_DETAIL_CHARS,
  DEFAULT_MAX_TASK_ID_CHARS,
  DEFAULT_MAX_TASK_PATHS,
  DEFAULT_MAX_TASK_PATH_CHARS,
} from "./defaults";

export { TASK_LIST_POLICY, resolveMaxTasks } from "./rules";

export { TaskListPipeline } from "./actions/TaskListPipeline";
export type { TaskListPipelineDependencies } from "./actions/TaskListPipeline";

export {
  taskListApplyInputSchema,
  taskListDraftItemSchema,
  taskListPatchItemSchema,
  taskListOperationSchema,
  taskItemSchema,
  taskItemStatusSchema,
  taskListSchema,
  taskListSourceSchema,
  taskListPurposeSchema,
  taskListApplyResultSchema,
  taskListApplyStatusSchema,
  taskListReasonCodeSchema,
  TaskListError,
  taskListErrorCodeSchema,
  noopModuleLogger,
} from "./types";
export type {
  TaskListApplyInput,
  TaskListDraftItem,
  TaskListPatchItem,
  TaskListOperation,
  TaskItem,
  TaskItemStatus,
  TaskList,
  TaskListSource,
  TaskListPurpose,
  TaskListApplyResult,
  TaskListApplyStatus,
  TaskListReasonCode,
  TaskListErrorCode,
  ModuleLoggerPort,
} from "./types";

export {
  parseTaskListMarkdown,
  serializeTaskListForPrompt,
  serializeTaskListGuidance,
  serializeTaskListMarkdown,
  serializeWorkingSetForLoop,
  serializeWorkingSetChecklistLines,
  WORKING_SET_MARKER,
  taskListProgress,
  collectCompletedTaskPaths,
  extractDiagnosticCodeHint,
  itemMentionsAnyPath,
  itemWriteTargetsMatchChangedFiles,
  normalizeTaskPath,
  taskItemPaths,
  taskPathsMatch,
} from "./serialize";

export {
  clipTaskTitle,
  isTerminalTaskStatus,
  isValidStatusTransition,
} from "./actions/steps/1-apply-update";

export { collectConcretePlanStepCandidates } from "./planStepCandidates";
