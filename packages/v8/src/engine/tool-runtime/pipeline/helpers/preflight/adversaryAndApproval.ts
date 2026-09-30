import {
  GrantValidationError,
} from "../../../actions";
import type { ToolInvocationInput } from "../../../contracts";
import { assertApprovalSatisfied } from "../../../internal/mutation/assertApprovalSatisfied";
import { fingerprintToolCall } from "../../../internal/mutation";
import {
  isAdversaryHighRiskTool,
  type AdversaryEvaluateResult,
} from "../../../internal/adversary";
import type { RegisteredTool } from "../../../internal/ToolRegistry";
import { buildRejectedResult } from "../buildToolResult";
import type { CallClock, ToolExecuteOptions } from "../../types";
import { extractMutationPaths } from "./extractMutationPaths";
import type { PreflightFailure } from "./types";

export async function runAdversaryAndApproval(params: {
  parsed: ToolInvocationInput;
  options: ToolExecuteOptions;
  registered: RegisteredTool;
  argumentsValue: unknown;
  clock: CallClock;
}): Promise<PreflightFailure | undefined> {
  const adversaryOutcome = await runAdversaryCheck(params);
  if (adversaryOutcome) {
    return adversaryOutcome;
  }

  const { parsed, options, registered, argumentsValue, clock } = params;
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

  return undefined;
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
