import { z } from "zod";

import {
  TOOL_REASON_CODES,
  TOOL_RUNTIME_ERROR_CODES,
} from "../../constants";

export const toolRuntimeErrorCodeSchema = z.enum(TOOL_RUNTIME_ERROR_CODES);
export type ToolRuntimeErrorCode = z.infer<typeof toolRuntimeErrorCodeSchema>;

export const toolReasonCodeSchema = z.enum(TOOL_REASON_CODES);
export type ToolReasonCode = z.infer<typeof toolReasonCodeSchema>;

export class ToolRuntimeError extends Error {
  public readonly code: ToolRuntimeErrorCode;
  public readonly details?: Readonly<Record<string, unknown>>;

  constructor(
    code: ToolRuntimeErrorCode,
    message: string,
    details?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
    this.name = "ToolRuntimeError";
    this.code = code;
    this.details = details;
  }
}
