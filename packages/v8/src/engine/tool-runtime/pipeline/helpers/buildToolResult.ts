import { ZodError } from "zod";

import { GrantValidationError } from "../../actions";
import { TOOL_RUNTIME_SCHEMA_VERSION } from "../../constants";
import {
  ToolRuntimeError,
  toolResultSchema,
} from "../../contracts";
import type {
  ToolInvocationInput,
  ToolReasonCode,
  ToolResult,
  ToolResultStatus,
} from "../../contracts";
import { CommandPolicyError } from "../../internal/CommandPolicy";
import { MutationError } from "../../internal/mutation";
import {
  measureJsonBytes,
  previewForAudit,
} from "../../internal/OutputSanitizer";
import { PathContainmentError } from "../../internal/PathContainment";
import type { SessionBudget } from "../../internal/SessionBudget";
import { SessionBudgetError } from "../../internal/SessionBudget";
import type { CallClock } from "../types";

export interface ToolResultBody {
  status: ToolResultStatus;
  reasonCode?: ToolReasonCode;
  truncated: boolean;
  redacted: boolean;
  output?: unknown;
  warnings: string[];
  argv?: string[];
  path?: string;
}

export function buildRejectedResult(params: {
  parsed: ToolInvocationInput;
  clock: CallClock;
  status: ToolResultStatus;
  reasonCode: ToolReasonCode;
  warnings?: string[];
  path?: string;
  argv?: string[];
  outputPreview?: string;
  output?: unknown;
}): ToolResult {
  const {
    parsed,
    clock,
    status,
    reasonCode,
    warnings = [],
    path,
    argv,
    outputPreview,
    output,
  } = params;
  const endedAt = new Date();
  const durationMs = Date.now() - clock.startedMs;

  return toolResultSchema.parse({
    schemaVersion: TOOL_RUNTIME_SCHEMA_VERSION,
    callId: parsed.callId,
    toolName: parsed.toolName,
    status,
    reasonCode,
    output,
    truncated: false,
    redacted: false,
    durationMs,
    bytesProduced: 0,
    warnings,
    audit: {
      callId: parsed.callId,
      toolName: parsed.toolName,
      startedAt: clock.startedAt.toISOString(),
      endedAt: endedAt.toISOString(),
      status,
      reasonCode,
      path,
      argv,
      inputPreview: previewForAudit(parsed.arguments),
      outputPreview,
      bytesProduced: 0,
      durationMs,
      truncated: false,
      redacted: false,
    },
  });
}

export function buildFinishedResult(params: {
  parsed: ToolInvocationInput;
  clock: CallClock;
  body: ToolResultBody;
  budget: SessionBudget;
}): ToolResult {
  const { parsed, clock, body, budget } = params;
  const endedAt = new Date();
  const durationMs = Date.now() - clock.startedMs;
  const bytesProduced = body.output ? measureJsonBytes(body.output) : 0;
  const warnings = [...body.warnings];

  try {
    budget.recordOutputBytes(bytesProduced);
  } catch (error) {
    if (error instanceof SessionBudgetError) {
      if (body.truncated && body.status === "succeeded") {
        warnings.push(
          "Serialized tool output exceeded grant maxOutputBytes after truncation.",
        );
      } else {
        return buildRejectedResult({
          parsed,
          clock,
          status: "rejected",
          reasonCode: error.reasonCode,
          warnings: ["Output exceeded grant maxOutputBytes after execution."],
          path: body.path,
          argv: body.argv,
          outputPreview: body.output
            ? previewForAudit(body.output)
            : undefined,
        });
      }
    } else {
      throw error;
    }
  }

  return toolResultSchema.parse({
    schemaVersion: TOOL_RUNTIME_SCHEMA_VERSION,
    callId: parsed.callId,
    toolName: parsed.toolName,
    status: body.status,
    reasonCode: body.reasonCode,
    output: body.output,
    truncated: body.truncated,
    redacted: body.redacted,
    durationMs,
    bytesProduced,
    warnings,
    audit: {
      callId: parsed.callId,
      toolName: parsed.toolName,
      startedAt: clock.startedAt.toISOString(),
      endedAt: endedAt.toISOString(),
      status: body.status,
      reasonCode: body.reasonCode,
      path: body.path,
      argv: body.argv,
      inputPreview: previewForAudit(parsed.arguments),
      outputPreview: body.output ? previewForAudit(body.output) : undefined,
      bytesProduced,
      durationMs,
      truncated: body.truncated,
      redacted: body.redacted,
    },
  });
}

export function formatZodIssues(error: ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join(".") : "arguments";
      return `${path}: ${issue.message}`;
    })
    .join("; ");
}

export function mapExecutionError(params: {
  error: unknown;
  parsed: ToolInvocationInput;
  clock: CallClock;
}): ToolResult {
  const { error, parsed, clock } = params;

  let reasonCode: ToolReasonCode = "execution_failed";
  let status: ToolResultStatus = "failed";
  let warnings: string[] = [];

  if (
    error instanceof GrantValidationError ||
    error instanceof PathContainmentError ||
    error instanceof CommandPolicyError ||
    error instanceof SessionBudgetError ||
    error instanceof MutationError
  ) {
    reasonCode = error.reasonCode;
    status = "rejected";
    warnings = [error.message];
  } else if (error instanceof ZodError) {
    reasonCode = "invalid_arguments";
    status = "rejected";
    warnings = [formatZodIssues(error)];
  } else if (error instanceof ToolRuntimeError) {
    reasonCode = "execution_failed";
    status = "failed";
    warnings = [error.message];
  } else if (error instanceof Error) {
    warnings = [error.message];
  }

  return buildRejectedResult({
    parsed,
    clock,
    status,
    reasonCode,
    warnings,
  });
}
