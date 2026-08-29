import { z } from "zod";

import { TASK_LIST_ERROR_CODES } from "../../constants";

export const taskListErrorCodeSchema = z.enum(TASK_LIST_ERROR_CODES);

export type TaskListErrorCode = z.infer<typeof taskListErrorCodeSchema>;

export class TaskListError extends Error {
  public readonly code: TaskListErrorCode;
  public readonly details?: Readonly<Record<string, unknown>>;

  constructor(
    code: TaskListErrorCode,
    message: string,
    details?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
    this.name = "TaskListError";
    this.code = code;
    this.details = details;
  }
}
