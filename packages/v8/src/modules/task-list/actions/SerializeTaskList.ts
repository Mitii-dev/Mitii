import { TASK_LIST_SCHEMA_VERSION } from "../constants";
import type { TaskItem, TaskItemStatus, TaskList } from "../contracts";
import { taskListSchema } from "../contracts";

const STATUS_MARK: Record<TaskItemStatus, string> = {
  pending: " ",
  active: ">",
  done: "x",
  skipped: "-",
  blocked: "!",
};

const MARK_STATUS: Record<string, TaskItemStatus> = {
  " ": "pending",
  "": "pending",
  ">": "active",
  x: "done",
  X: "done",
  "-": "skipped",
  "!": "blocked",
};

/**
 * Serialize a task list to Cursor-style markdown checkboxes.
 */
export function serializeTaskListMarkdown(taskList: TaskList): string {
  const heading = taskList.title?.trim() || "Task list";
  const lines = [
    `# ${heading}`,
    "",
    "<!-- Edit checkboxes: [ ] pending, [>] active, [x] done, [-] skipped, [!] blocked -->",
    "",
  ];
  for (const item of taskList.items) {
    lines.push(`- [${STATUS_MARK[item.status]}] ${item.title}`);
  }
  return `${lines.join("\n")}\n`;
}

/**
 * Compact prompt form used by Agent Engine system text.
 */
export function serializeTaskListForPrompt(taskList: TaskList): string {
  if (taskList.items.length === 0) {
    return serializeTaskListGuidance();
  }
  const lines = [
    "<task_list trust=\"instruction\">",
    "Live working list for this run. Use update_todos to keep it current as soon as the work is concrete.",
    "If this is a multi-step run and the list is empty after the first read/diagnose tool turn, call update_todos type=replace with concrete titles naming a file, failure, or behavior.",
    "Keep exactly one item active. Before finishing a slice, patch the active item to done and the next pending item to active.",
    "Do not copy Discover/Change/Verify process labels into titles. If a plan-derived list is still process-shaped, replace it with type=replace and items (or todos) using title (or content); otherwise prefer patch by id.",
    "Do not mark remaining items done just because the turn is ending. Skip update_todos only for trivial single-step work.",
  ];
  for (const item of taskList.items) {
    lines.push(`- [${STATUS_MARK[item.status]}] ${item.id}: ${item.title}`);
  }
  lines.push("</task_list>");
  return lines.join("\n");
}

/**
 * Prompt block when a list exists, or standing guidance so Agent creates one.
 */
export function serializeTaskListGuidance(taskList?: TaskList): string {
  if (taskList && taskList.items.length > 0) {
    return serializeTaskListForPrompt(taskList);
  }
  return [
    "<task_list trust=\"instruction\">",
    "No live working list yet. If this is a multi-step run, after the first read/diagnose tool turn call update_todos with type=replace.",
    "Each title must name a concrete file, failure, or user-visible behavior.",
    "Do not copy Discover/Change/Verify process labels or skill playbook bullets into titles.",
    "Keep exactly one item active. Before finishing a slice, patch the active item to done and the next pending item to active.",
    "Skip update_todos only for trivial single-step work.",
    "</task_list>",
  ].join("\n");
}

export function parseTaskListMarkdown(
  text: string,
  source: TaskList["source"] = "user",
): TaskList | undefined {
  const items: TaskItem[] = [];
  let title: string | undefined;
  const lines = text.split(/\r?\n/);

  for (const raw of lines) {
    const heading = raw.match(/^#{1,3}\s+(.+)$/);
    if (heading && !title) {
      const name = heading[1]!.trim();
      if (name && !/^focus chain/i.test(name) && name.toLowerCase() !== "task list") {
        title = name.slice(0, 200);
      }
      continue;
    }
    const match = raw.match(
      /^\s*[-*]\s*\[([ xX>\-!])\]\s+(.+?)\s*$/,
    );
    if (!match) continue;
    const mark = match[1] ?? " ";
    const titleText = match[2]!.trim();
    if (!titleText) continue;
    const status = MARK_STATUS[mark] ?? "pending";
    items.push({
      id: `task-${items.length + 1}`,
      title: titleText.slice(0, 200),
      status,
    });
    if (items.length >= 8) break;
  }

  if (items.length === 0) return undefined;

  const parsed = taskListSchema.safeParse({
    schemaVersion: TASK_LIST_SCHEMA_VERSION,
    source,
    ...(title ? { title } : {}),
    items: ensureSingleActive(items),
  });
  return parsed.success ? parsed.data : undefined;
}

function ensureSingleActive(items: TaskItem[]): TaskItem[] {
  let seenActive = false;
  return items.map((item) => {
    if (item.status !== "active") return item;
    if (seenActive) {
      return { ...item, status: "pending" };
    }
    seenActive = true;
    return item;
  });
}
