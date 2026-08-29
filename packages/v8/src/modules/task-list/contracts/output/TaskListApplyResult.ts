import { z } from "zod";

import {
  TASK_LIST_APPLY_STATUSES,
  TASK_LIST_REASON_CODES,
  TASK_LIST_SCHEMA_VERSION,
} from "../../constants";
import { taskListSchema } from "./TaskList";

export const taskListApplyStatusSchema = z.enum(TASK_LIST_APPLY_STATUSES);
export const taskListReasonCodeSchema = z.enum(TASK_LIST_REASON_CODES);

export const taskListApplyResultSchema = z
  .object({
    schemaVersion: z.literal(TASK_LIST_SCHEMA_VERSION),
    status: taskListApplyStatusSchema,
    taskList: taskListSchema.optional(),
    warnings: z.array(z.string()),
    reasonCodes: z.array(taskListReasonCodeSchema).min(1),
  })
  .strict();

export type TaskListApplyResult = z.infer<typeof taskListApplyResultSchema>;
export type TaskListApplyStatus = z.infer<typeof taskListApplyStatusSchema>;
export type TaskListReasonCode = z.infer<typeof taskListReasonCodeSchema>;
