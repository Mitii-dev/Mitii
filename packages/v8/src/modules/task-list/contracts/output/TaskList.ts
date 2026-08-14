import { z } from "zod";

import {
  TASK_ITEM_STATUSES,
  TASK_LIST_SCHEMA_VERSION,
  TASK_LIST_SOURCES,
} from "../../constants";
import {
  DEFAULT_MAX_TASK_DETAIL_CHARS,
  DEFAULT_MAX_TASK_ID_CHARS,
  DEFAULT_MAX_TASK_TITLE_CHARS,
  DEFAULT_MAX_TASKS,
} from "../../defaults";

export const taskItemStatusSchema = z.enum(TASK_ITEM_STATUSES);
export const taskListSourceSchema = z.enum(TASK_LIST_SOURCES);

export type TaskItemStatus =
  | "pending"
  | "active"
  | "done"
  | "skipped"
  | "blocked";
export type TaskListSource = "plan" | "agent" | "user";

export const taskItemSchema = z
  .object({
    id: z.string().min(1).max(DEFAULT_MAX_TASK_ID_CHARS),
    title: z.string().min(1).max(DEFAULT_MAX_TASK_TITLE_CHARS),
    status: taskItemStatusSchema,
    detail: z.string().min(1).max(DEFAULT_MAX_TASK_DETAIL_CHARS).optional(),
    /** Optional plan step/phase id this task was derived from. */
    sourceRef: z.string().min(1).max(DEFAULT_MAX_TASK_ID_CHARS).optional(),
  })
  .strict();

export interface TaskItem {
  id: string;
  title: string;
  status: TaskItemStatus;
  detail?: string;
  sourceRef?: string;
}

/**
 * Object shape only. `taskListSchema` adds unique-id / single-active checks.
 * Infer `TaskList` from this schema so public .d.ts types stay concrete
 * (`superRefine` emits ZodEffects, which collapses to `any` for some hosts).
 */
export const taskListObjectSchema = z
  .object({
    schemaVersion: z.literal(TASK_LIST_SCHEMA_VERSION),
    source: taskListSourceSchema,
    title: z.string().min(1).max(DEFAULT_MAX_TASK_TITLE_CHARS).optional(),
    items: z.array(taskItemSchema).max(DEFAULT_MAX_TASKS),
  })
  .strict();

export const taskListSchema = taskListObjectSchema.superRefine((value, ctx) => {
  const ids = new Set<string>();
  let activeCount = 0;
  for (const [index, item] of value.items.entries()) {
    if (ids.has(item.id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Task ids must be unique.",
        path: ["items", index, "id"],
      });
    }
    ids.add(item.id);
    if (item.status === "active") {
      activeCount += 1;
    }
  }
  if (activeCount > 1) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "At most one task may be active.",
      path: ["items"],
    });
  }
});

export interface TaskList {
  schemaVersion: 1;
  source: TaskListSource;
  title?: string;
  items: TaskItem[];
}
