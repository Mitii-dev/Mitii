import { z } from "zod";

import { PROMPT_CONSTRUCTION_ERROR_CODES } from "../../constants";

export const promptConstructionErrorCodeSchema = z.enum(
  PROMPT_CONSTRUCTION_ERROR_CODES,
);

export type PromptConstructionErrorCode = z.infer<
  typeof promptConstructionErrorCodeSchema
>;

export class PromptConstructionError extends Error {
  public readonly code: PromptConstructionErrorCode;
  public readonly details?: Readonly<Record<string, unknown>>;

  constructor(
    code: PromptConstructionErrorCode,
    message: string,
    details?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
    this.name = "PromptConstructionError";
    this.code = code;
    this.details = details;
  }
}
