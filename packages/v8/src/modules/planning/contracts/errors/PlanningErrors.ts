import { z } from "zod";

import { PLANNING_ERROR_CODES } from "../../constants";

export const planningErrorCodeSchema = z.enum(PLANNING_ERROR_CODES);

export type PlanningErrorCode = z.infer<typeof planningErrorCodeSchema>;

export class PlanningError extends Error {
  public readonly code: PlanningErrorCode;
  public readonly details?: Readonly<Record<string, unknown>>;

  constructor(
    code: PlanningErrorCode,
    message: string,
    details?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
    this.name = "PlanningError";
    this.code = code;
    this.details = details;
  }
}
