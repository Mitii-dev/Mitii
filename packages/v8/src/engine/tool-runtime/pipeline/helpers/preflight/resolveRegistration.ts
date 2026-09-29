import type { ToolInvocationInput } from "../../../contracts";
import type { SessionBudget } from "../../../internal/SessionBudget";
import { SessionBudgetError } from "../../../internal/SessionBudget";
import type { RegisteredTool, ToolRegistry } from "../../../internal/ToolRegistry";
import { buildRejectedResult } from "../buildToolResult";
import type { CallClock, ToolExecuteOptions } from "../../types";
import type { PreflightFailure } from "./types";

export type ResolveRegistrationSuccess = {
  ok: true;
  registered: RegisteredTool;
};

export async function resolveRegistration(params: {
  parsed: ToolInvocationInput;
  options: ToolExecuteOptions;
  budget: SessionBudget;
  registry: ToolRegistry;
  clock: CallClock;
}): Promise<ResolveRegistrationSuccess | PreflightFailure> {
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

  return { ok: true, registered };
}
