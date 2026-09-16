import { z } from "zod";

import { REVIEW_ERROR_CODES } from "../../constants";

export const reviewErrorCodeSchema = z.enum(REVIEW_ERROR_CODES);

export type ReviewErrorCode = z.infer<typeof reviewErrorCodeSchema>;

export class ReviewError extends Error {
  constructor(
    public readonly code: ReviewErrorCode,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ReviewError";
  }
}
