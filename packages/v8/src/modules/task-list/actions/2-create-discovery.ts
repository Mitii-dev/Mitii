import { TASK_LIST_SCHEMA_VERSION } from "../constants";
import { DEFAULT_MAX_TASK_TITLE_CHARS } from "../defaults";
import { taskListSchema } from "../contracts";
import type { TaskList } from "../contracts";

const DEFAULT_DISCOVERY_TITLE = "Investigating request";

/**
 * Temporary UI progress list for a read-only discovery pass.
 * Never treat this as the approved execution checklist.
 */
export function createDiscoveryTaskList(title?: string): TaskList {
  return taskListSchema.parse({
    schemaVersion: TASK_LIST_SCHEMA_VERSION,
    source: "discovery",
    purpose: "discovery",
    title: (title ?? DEFAULT_DISCOVERY_TITLE).slice(
      0,
      DEFAULT_MAX_TASK_TITLE_CHARS,
    ),
    items: [
      {
        id: "find-entrypoint",
        title: "Find relevant entrypoint",
        status: "active",
      },
      {
        id: "read-state",
        title: "Read related state flow",
        status: "pending",
      },
      {
        id: "identify-checks",
        title: "Identify verification checks",
        status: "pending",
      },
    ],
  });
}

export function isDiscoveryTaskList(taskList: TaskList | undefined): boolean {
  if (!taskList) {
    return false;
  }
  return taskList.purpose === "discovery" || taskList.source === "discovery";
}
