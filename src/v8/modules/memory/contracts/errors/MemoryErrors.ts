import { z } from "zod";

import { MEMORY_ERROR_CODES } from "../../constants";

export const memoryErrorCodeSchema = z.enum(MEMORY_ERROR_CODES);

export type MemoryErrorCode = z.infer<typeof memoryErrorCodeSchema>;

export class MemoryError extends Error {
  public readonly code: MemoryErrorCode;
  public readonly details?: Readonly<Record<string, unknown>>;

  constructor(
    code: MemoryErrorCode,
    message: string,
    details?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
    this.name = "MemoryError";
    this.code = code;
    this.details = details;
  }
}
