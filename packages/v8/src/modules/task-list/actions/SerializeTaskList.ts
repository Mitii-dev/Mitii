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
    "Live working list for this run. Check items off with update_todos as you finish them.",
    "Titles must stay concrete (file, error, or behavior). Rewrite with replace if this list is still process steps.",
    "Do not mark remaining items done just because the turn is ending.",
    "Keep at most 8 items. Use replace to rewrite, patch to update status.",
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
    "No live working list yet. After you know the concrete work, call update_todos with type=replace.",
    "Each title must name a file, error, or user-visible behavior.",
    "Do not copy Discover/Change/Verify process steps or skill playbook bullets.",
    "Mark exactly one item active, then done when that slice is finished.",
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
