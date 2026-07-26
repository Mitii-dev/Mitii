import { z } from "zod";

import { VERIFICATION_ERROR_CODES } from "../../constants";

export const verificationErrorCodeSchema = z.enum(VERIFICATION_ERROR_CODES);

export type VerificationErrorCode = z.infer<typeof verificationErrorCodeSchema>;

export class VerificationError extends Error {
  public readonly code: VerificationErrorCode;
  public readonly details?: Readonly<Record<string, unknown>>;

  constructor(
    code: VerificationErrorCode,
    message: string,
    details?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
    this.name = "VerificationError";
    this.code = code;
    this.details = details;
  }
}
