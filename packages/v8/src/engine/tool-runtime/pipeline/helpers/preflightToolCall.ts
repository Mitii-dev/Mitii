import { ZodError } from "zod";

import {
  GrantValidationError,
  MutationBatchValidationError,
  validateMutationBatch,
  validateToolAgainstGrant,
} from "../../actions";
import type { ToolInvocationInput, ToolResult } from "../../contracts";
import { assertApprovalSatisfied } from "../../internal/mutation/assertApprovalSatisfied";
import { fingerprintToolCall } from "../../internal/mutation";
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
 * Budget, cancellation, registration, grant, approval, and argument checks.
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

  try {
    validateMutationBatch({
      toolName: parsed.toolName,
      arguments: parsed.arguments,
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

  try {
    assertApprovalSatisfied({
      tool: registered.definition,
      grant: parsed.grant,
      arguments: parsed.arguments,
      approval: options.approval,
    });
  } catch (error) {
    if (error instanceof GrantValidationError) {
      const fingerprint = fingerprintToolCall(
        parsed.toolName,
        parsed.arguments,
      );
      return {
        ok: false,
        result: buildRejectedResult({
          parsed,
          clock,
          status: "rejected",
          reasonCode: error.reasonCode,
          warnings: [error.message],
          output:
            error.reasonCode === "approval_required"
              ? {
                  approvalRequired: true,
                  fingerprint,
                  toolName: parsed.toolName,
                  paths: extractMutationPaths(parsed.toolName, parsed.arguments),
                }
              : undefined,
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

function extractMutationPaths(
  toolName: string,
  argumentsValue: unknown,
): string[] {
  if (!argumentsValue || typeof argumentsValue !== "object") {
    return [];
  }
  const args = argumentsValue as Record<string, unknown>;

  if (toolName === "apply_patch") {
    if (!("patches" in args) || !Array.isArray(args.patches)) {
      return [];
    }
    return (args.patches as Array<{ path?: unknown }>)
      .map((patch) => (typeof patch.path === "string" ? patch.path : undefined))
      .filter((path): path is string => typeof path === "string");
  }

  if (toolName === "delete_file" || toolName === "delete_directory") {
    return typeof args.path === "string" ? [args.path] : [];
  }

  if (toolName === "move_file") {
    const paths: string[] = [];
    if (typeof args.from === "string") {
      paths.push(args.from);
    }
    if (typeof args.to === "string") {
      paths.push(args.to);
    }
    return paths;
  }

  return [];
}
