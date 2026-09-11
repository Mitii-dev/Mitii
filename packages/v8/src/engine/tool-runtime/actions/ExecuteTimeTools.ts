import {
  convertTime,
  getCurrentTime,
  resolveLocalTimezoneId,
  TimeToolError,
} from "../internal/TimeTools";
import {
  convertTimeInputSchema,
  convertTimeOutputSchema,
  getCurrentTimeInputSchema,
  getCurrentTimeOutputSchema,
} from "../internal/ToolCatalog";
import { GrantValidationError } from "./ValidateGrant";

export async function executeGetCurrentTime(params: {
  arguments: unknown;
}): Promise<{
  output: unknown;
  truncated: boolean;
  redacted: boolean;
}> {
  const input = getCurrentTimeInputSchema.parse(params.arguments);
  const timezone = input.timezone?.trim() || resolveLocalTimezoneId();
  try {
    const snapshot = getCurrentTime(timezone);
    return {
      output: getCurrentTimeOutputSchema.parse(snapshot),
      truncated: false,
      redacted: false,
    };
  } catch (error) {
    throw mapTimeError(error);
  }
}

export async function executeConvertTime(params: {
  arguments: unknown;
}): Promise<{
  output: unknown;
  truncated: boolean;
  redacted: boolean;
}> {
  const input = convertTimeInputSchema.parse(params.arguments);
  try {
    const result = convertTime({
      sourceTimezone: input.sourceTimezone,
      time: input.time,
      targetTimezone: input.targetTimezone,
    });
    return {
      output: convertTimeOutputSchema.parse(result),
      truncated: false,
      redacted: false,
    };
  } catch (error) {
    throw mapTimeError(error);
  }
}

function mapTimeError(error: unknown): Error {
  if (error instanceof TimeToolError) {
    return new GrantValidationError("invalid_arguments", error.message);
  }
  return error instanceof Error ? error : new Error(String(error));
}
