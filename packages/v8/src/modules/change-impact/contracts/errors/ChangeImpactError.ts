import { z } from "zod";

import { CHANGE_IMPACT_ERROR_CODES } from "../../constants";

export const changeImpactErrorCodeSchema = z.enum(
  CHANGE_IMPACT_ERROR_CODES,
);

export type ChangeImpactErrorCode = z.infer<
  typeof changeImpactErrorCodeSchema
>;

export class ChangeImpactError extends Error {
  constructor(
    public readonly code: ChangeImpactErrorCode,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ChangeImpactError";
  }
}
