import { ZodError } from "zod";

import { GrantValidationError, validateToolAgainstGrant } from "../../actions";
import type { ToolInvocationInput, ToolResult } from "../../contracts";
import type { SessionBudget } from "../../internal/SessionBudget";
import { SessionBudgetError } from "../../internal/SessionBudget";
import type { RegisteredTool, ToolRegistry } from "../../internal/ToolRegistry";
import { buildRejectedResult } from "./buildToolResult";
import type { CallClock, ToolExecuteOptions } from "../types";

export type PreflightSuccess = {
  ok: true;
  registered: RegisteredTool;
  maxOutputBytes: number;
};

export type PreflightFailure = {
  ok: false;
  result: ToolResult;
};

export type PreflightOutcome = PreflightSuccess | PreflightFailure;

/**
 * Budget, cancellation, registration, grant, and argument checks.
 * Returns a rejected ToolResult when preflight fails.
 */
export function preflightToolCall(params: {
  parsed: ToolInvocationInput;
  options: ToolExecuteOptions;
  budget: SessionBudget;
  registry: ToolRegistry;
  clock: CallClock;
}): PreflightOutcome {
  const { parsed, options, budget, registry, clock } = params;

  try {
    budget.beginCall();
  } catch (error) {
    if (error instanceof SessionBudgetError) {
      return {
        ok: false,
        result: buildRejectedResult({
          parsed,
          clock,
          status: "rejected",
          reasonCode: error.reasonCode,
        }),
      };
    }
    throw error;
  }

  if (options.signal?.aborted) {
    return {
      ok: false,
      result: buildRejectedResult({
        parsed,
        clock,
        status: "cancelled",
        reasonCode: "cancelled",
      }),
    };
  }

  const registered = registry.get(parsed.toolName);
  if (!registered) {
    return {
      ok: false,
      result: buildRejectedResult({
        parsed,
        clock,
        status: "rejected",
        reasonCode: "tool_not_registered",
      }),
    };
  }

  try {
    validateToolAgainstGrant({
      tool: registered.definition,
      grant: parsed.grant,
    });
  } catch (error) {
    if (error instanceof GrantValidationError) {
      return {
        ok: false,
        result: buildRejectedResult({
          parsed,
          clock,
          status: "rejected",
          reasonCode: error.reasonCode,
        }),
      };
    }
    throw error;
  }

  try {
    registered.definition.inputSchema.parse(parsed.arguments);
  } catch (error) {
    if (error instanceof ZodError) {
      return {
        ok: false,
        result: buildRejectedResult({
          parsed,
          clock,
          status: "rejected",
          reasonCode: "invalid_arguments",
          warnings: [error.issues.map((issue) => issue.message).join("; ")],
        }),
      };
    }
    throw error;
  }

  const maxOutputBytes = Math.min(
    registered.definition.maxOutputBytes,
    budget.remainingOutputBytes() || registered.definition.maxOutputBytes,
    parsed.grant.limits.maxOutputBytes,
  );

  return { ok: true, registered, maxOutputBytes };
}
