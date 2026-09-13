import { ZodError } from "zod";

import {
  GrantValidationError,
  MutationBatchValidationError,
  validateMutationBatch,
  validateToolAgainstGrant,
} from "../../actions";
import type { ToolInvocationInput, ToolResult } from "../../contracts";
import { assertApprovalSatisfied } from "../../internal/mutation/assertApprovalSatisfied";
import { normalizeApplyPatchArguments } from "../../internal/normalizeApplyPatchArguments";
import { normalizeCommonToolArguments } from "../../internal/normalizeCommonToolArguments";
import { coerceArgumentsToSchema } from "../../internal/CoerceArgumentsToSchema";
import { fingerprintToolCall } from "../../internal/mutation";
import type { SessionBudget } from "../../internal/SessionBudget";
import { SessionBudgetError } from "../../internal/SessionBudget";
import type { RegisteredTool, ToolRegistry } from "../../internal/ToolRegistry";
import {
  StructuralShadowGrantAuthorizer,
  type ShadowGrantAuthorizer,
} from "../../internal/shadow/ShadowGrantAuthorizer";
import {
  isAdversaryHighRiskTool,
  type AdversaryEvaluateResult,
} from "../../internal/adversary";
import { buildRejectedResult, formatZodIssues } from "./buildToolResult";
import type { CallClock, ToolExecuteOptions } from "../types";

export type PreflightSuccess = {
  ok: true;
  registered: RegisteredTool;
  maxOutputBytes: number;
  argumentsValue: unknown;
};

export type PreflightFailure = {
  ok: false;
  result: ToolResult;
};

export type PreflightOutcome = PreflightSuccess | PreflightFailure;

const DEFAULT_SHADOW_AUTHORIZER = new StructuralShadowGrantAuthorizer();

/**
 * Budget, cancellation, registration, grant, approval, adversary, and argument checks.
 * Returns a rejected ToolResult when preflight fails.
 */
export async function preflightToolCall(params: {
  parsed: ToolInvocationInput;
  options: ToolExecuteOptions;
  budget: SessionBudget;
  registry: ToolRegistry;
  clock: CallClock;
}): Promise<PreflightOutcome> {
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

  let primaryAllowed = true;
  try {
    validateToolAgainstGrant({
      tool: registered.definition,
      grant: parsed.grant,
    });
  } catch (error) {
    if (error instanceof GrantValidationError) {
      primaryAllowed = false;
      runShadowAuthorize({
        authorizer: options.shadowAuthorizer ?? DEFAULT_SHADOW_AUTHORIZER,
        tool: registered.definition,
        grant: parsed.grant,
        arguments: parsed.arguments,
        primaryAllowed,
        onShadowAuthorize: options.onShadowAuthorize,
      });
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

  const shadow = runShadowAuthorize({
    authorizer: options.shadowAuthorizer ?? DEFAULT_SHADOW_AUTHORIZER,
    tool: registered.definition,
    grant: parsed.grant,
    arguments: parsed.arguments,
    primaryAllowed: true,
    onShadowAuthorize: options.onShadowAuthorize,
  });

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

  const adversaryOutcome = await runAdversaryCheck({
    parsed,
    options,
    registered,
    argumentsValue,
    clock,
  });
  if (adversaryOutcome) {
    return adversaryOutcome;
  }

  try {
    assertApprovalSatisfied({
      tool: registered.definition,
      grant: parsed.grant,
      arguments: argumentsValue,
      approval: options.approval,
    });
  } catch (error) {
    if (error instanceof GrantValidationError) {
      const fingerprint = fingerprintToolCall(
        parsed.toolName,
        argumentsValue,
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
                  paths: extractMutationPaths(parsed.toolName, argumentsValue),
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

  return { ok: true, registered, maxOutputBytes, argumentsValue };
}

async function runAdversaryCheck(params: {
  parsed: ToolInvocationInput;
  options: ToolExecuteOptions;
  registered: RegisteredTool;
  argumentsValue: unknown;
  clock: CallClock;
}): Promise<PreflightFailure | undefined> {
  const { parsed, options, registered, argumentsValue, clock } = params;
  if (!options.adversary) {
    return undefined;
  }
  if (!isAdversaryHighRiskTool(parsed.toolName)) {
    return undefined;
  }

  let result: AdversaryEvaluateResult;
  try {
    result = await options.adversary.evaluate({
      toolName: parsed.toolName,
      arguments: argumentsValue,
      grant: parsed.grant,
      tool: registered.definition,
      workspaceRoot: parsed.workspaceRoot,
    });
  } catch (error) {
    const failMode = options.adversaryFailMode ?? "fail_closed";
    result = {
      decision: failMode === "fail_open" ? "ALLOW" : "BLOCK",
      reason: `Adversary error (${failMode}): ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }

  options.onAdversary?.({ toolName: parsed.toolName, result });

  if (result.decision === "ALLOW") {
    return undefined;
  }

  if (result.decision === "ASK") {
    const fingerprint = fingerprintToolCall(parsed.toolName, argumentsValue);
    return {
      ok: false,
      result: buildRejectedResult({
        parsed,
        clock,
        status: "rejected",
        reasonCode: "approval_required",
        warnings: [result.reason],
        output: {
          approvalRequired: true,
          fingerprint,
          toolName: parsed.toolName,
          paths: extractMutationPaths(parsed.toolName, argumentsValue),
          adversaryAsk: true,
        },
      }),
    };
  }

  return {
    ok: false,
    result: buildRejectedResult({
      parsed,
      clock,
      status: "rejected",
      reasonCode: "tool_not_allowed",
      warnings: [result.reason],
    }),
  };
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
    const normalized = normalizeApplyPatchArguments(argumentsValue);
    if (
      !normalized ||
      typeof normalized !== "object" ||
      !("patches" in normalized) ||
      !Array.isArray((normalized as { patches: unknown }).patches)
    ) {
      return [];
    }
    return ((normalized as { patches: Array<{ path?: unknown }> }).patches)
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

function runShadowAuthorize(params: {
  authorizer: ShadowGrantAuthorizer;
  tool: RegisteredTool["definition"];
  grant: ToolInvocationInput["grant"];
  arguments: unknown;
  primaryAllowed: boolean;
  onShadowAuthorize?: ToolExecuteOptions["onShadowAuthorize"];
}) {
  const shadow = params.authorizer.authorize({
    tool: params.tool,
    grant: params.grant,
    arguments: params.arguments,
  });
  const disagreed =
    (params.primaryAllowed && shadow.decision === "Deny") ||
    (!params.primaryAllowed && shadow.decision === "Allow");
  params.onShadowAuthorize?.({
    toolName: params.tool.name,
    primaryAllowed: params.primaryAllowed,
    shadow,
    disagreed,
  });
  return shadow;
}
