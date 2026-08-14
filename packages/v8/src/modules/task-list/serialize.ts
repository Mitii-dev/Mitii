import type { TaskList } from "./contracts";

export {
  parseTaskListMarkdown,
  serializeTaskListForPrompt,
  serializeTaskListGuidance,
  serializeTaskListMarkdown,
} from "./actions/SerializeTaskList";

export function taskListProgress(taskList: TaskList): {
  completedCount: number;
  totalCount: number;
  activeId?: string;
} {
  const completedCount = taskList.items.filter(
    (item) => item.status === "done",
  ).length;
  const active = taskList.items.find((item) => item.status === "active");
  return {
    completedCount,
    totalCount: taskList.items.length,
    ...(active ? { activeId: active.id } : {}),
  };
}
