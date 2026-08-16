import { z } from "zod";

import { WINDOW_BUDGET_ERROR_CODES } from "../../constants";

export const windowBudgetErrorCodeSchema = z.enum(WINDOW_BUDGET_ERROR_CODES);

export type WindowBudgetErrorCode = z.infer<typeof windowBudgetErrorCodeSchema>;

export class WindowBudgetError extends Error {
  public readonly code: WindowBudgetErrorCode;
  public readonly details?: Readonly<Record<string, unknown>>;

  constructor(
    code: WindowBudgetErrorCode,
    message: string,
    details?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
    this.name = "WindowBudgetError";
    this.code = code;
    this.details = details;
  }
}
