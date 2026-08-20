import { z } from "zod";

import { TASK_LIST_SCHEMA_VERSION } from "../../constants";
import {
  DEFAULT_MAX_TASK_ID_CHARS,
  DEFAULT_MAX_TASK_TITLE_CHARS,
  MAX_TASKS_CAP,
} from "../../defaults";
import {
  taskItemStatusSchema,
  taskListPurposeSchema,
  taskListSchema,
  taskListSourceSchema,
} from "../output/TaskList";

export const taskListDraftItemSchema = z
  .object({
    id: z.string().min(1).max(DEFAULT_MAX_TASK_ID_CHARS).optional(),
    title: z.string().min(1).max(DEFAULT_MAX_TASK_TITLE_CHARS),
    status: taskItemStatusSchema.optional(),
    detail: z.string().min(1).max(400).optional(),
  })
  .strict();

export const taskListPatchItemSchema = z
  .object({
    id: z.string().min(1).max(DEFAULT_MAX_TASK_ID_CHARS),
    status: taskItemStatusSchema.optional(),
    title: z.string().min(1).max(DEFAULT_MAX_TASK_TITLE_CHARS).optional(),
    detail: z.string().min(1).max(400).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      value.status === undefined &&
      value.title === undefined &&
      value.detail === undefined
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Patch item requires status, title, or detail.",
      });
    }
  });

export const taskListOperationSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("replace"),
      items: z
        .array(taskListDraftItemSchema)
        .min(1)
        .max(MAX_TASKS_CAP),
    })
    .strict(),
  z
    .object({
      type: z.literal("patch"),
      items: z.array(taskListPatchItemSchema).min(1).max(MAX_TASKS_CAP),
    })
    .strict(),
  z
    .object({
      type: z.literal("clear"),
    })
    .strict(),
]);

export const taskListApplyInputSchema = z
  .object({
    schemaVersion: z.literal(TASK_LIST_SCHEMA_VERSION),
    current: taskListSchema.optional(),
    source: taskListSourceSchema,
    purpose: taskListPurposeSchema.optional(),
    title: z.string().min(1).max(DEFAULT_MAX_TASK_TITLE_CHARS).optional(),
    maxTasks: z.number().int().positive().max(MAX_TASKS_CAP).optional(),
    operation: taskListOperationSchema,
  })
  .strict();

export type TaskListDraftItem = z.infer<typeof taskListDraftItemSchema>;
export type TaskListPatchItem = z.infer<typeof taskListPatchItemSchema>;
export type TaskListOperation = z.infer<typeof taskListOperationSchema>;
export type TaskListApplyInput = z.infer<typeof taskListApplyInputSchema>;
