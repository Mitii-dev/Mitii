import { z } from "zod";

import { CODE_NAVIGATION_ERROR_CODES } from "../../constants";

export const codeNavigationErrorCodeSchema = z.enum(
  CODE_NAVIGATION_ERROR_CODES,
);

export type CodeNavigationErrorCode = z.infer<
  typeof codeNavigationErrorCodeSchema
>;

export class CodeNavigationError extends Error {
  public readonly code: CodeNavigationErrorCode;
  public readonly details?: Readonly<Record<string, unknown>>;

  constructor(
    code: CodeNavigationErrorCode,
    message: string,
    details?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
    this.name = "CodeNavigationError";
    this.code = code;
    this.details = details;
  }
}
