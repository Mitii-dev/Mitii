import { ZodError } from "zod";

import {
  MutationBatchValidationError,
  validateMutationBatch,
} from "../../../actions";
import type { ToolInvocationInput } from "../../../contracts";
import { normalizeApplyPatchArguments } from "../../../internal/normalizeApplyPatchArguments";
import { normalizeCommonToolArguments } from "../../../internal/normalizeCommonToolArguments";
import { coerceArgumentsToSchema } from "../../../internal/CoerceArgumentsToSchema";
import type { RegisteredTool } from "../../../internal/ToolRegistry";
import type { ShadowAuthorizeResult } from "../../../internal/shadow/ShadowGrantAuthorizer";
import { buildRejectedResult, formatZodIssues } from "../buildToolResult";
import type { CallClock, ToolExecuteOptions } from "../../types";
import type { PreflightFailure } from "./types";

export type NormalizeArgsSuccess = {
  ok: true;
  argumentsValue: unknown;
};

export function normalizeAndValidateArgs(params: {
  parsed: ToolInvocationInput;
  options: ToolExecuteOptions;
  registered: RegisteredTool;
  shadow: ShadowAuthorizeResult;
  clock: CallClock;
}): NormalizeArgsSuccess | PreflightFailure {
  const { parsed, options, registered, shadow, clock } = params;

  const rawArguments =
    parsed.toolName === "apply_patch"
      ? normalizeApplyPatchArguments(parsed.arguments)
      : normalizeCommonToolArguments(parsed.toolName, parsed.arguments);
  const argumentsValue = coerceArgumentsToSchema(
    rawArguments,
    registered.definition.inputSchema,
  );

  if (
    options.enforceShadowAuthorization === true &&
    shadow.decision === "Deny"
  ) {
    return {
      ok: false,
      result: buildRejectedResult({
        parsed,
        clock,
        status: "rejected",
        reasonCode: "tool_not_allowed",
        warnings: [
          `Shadow grant authorizer denied tool "${parsed.toolName}": ${shadow.reason}`,
        ],
      }),
    };
  }

  try {
    registered.definition.inputSchema.parse(argumentsValue);
  } catch (error) {
    if (error instanceof ZodError) {
      return {
        ok: false,
        result: buildRejectedResult({
          parsed,
          clock,
          status: "rejected",
          reasonCode: "invalid_arguments",
          warnings: [formatZodIssues(error)],
        }),
      };
    }
    throw error;
  }

  try {
    validateMutationBatch({
      toolName: parsed.toolName,
      arguments: argumentsValue,
      grant: parsed.grant,
    });
  } catch (error) {
    if (error instanceof MutationBatchValidationError) {
      return {
        ok: false,
        result: buildRejectedResult({
          parsed,
          clock,
          status: "rejected",
          reasonCode: error.reasonCode,
          warnings: [error.message],
        }),
      };
    }
    throw error;
  }

  return { ok: true, argumentsValue };
}
