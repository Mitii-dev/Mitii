import {
  WINDOW_BUDGET_SCHEMA_VERSION,
  deriveWindowPolicy,
  type WindowPolicy,
} from "../../../modules/window-budget";
import {
  assertWindowBand,
  splitPlanExecuteBudgets,
} from "../../helpers/plan";
import type { StepContext } from "./StepContext";

/**
 * Step 1 — derive WindowPolicy from host context window (S11-BUDGET / S3A-WINDOW).
 * Numbers owned by window-budget module; runtime stores policy + band assert +
 * plan/execute budget split.
 */
export function applyWindowPolicy(ctx: StepContext): WindowPolicy | undefined {
  const contextWindowTokens =
    typeof ctx.input.contextWindowTokens === "number" &&
    ctx.input.contextWindowTokens > 0
      ? ctx.input.contextWindowTokens
      : 80_000;

  const mode =
    ctx.mode === "ask" || ctx.mode === "plan" || ctx.mode === "agent"
      ? ctx.mode
      : "agent";

  try {
    const policy = deriveWindowPolicy({
      schemaVersion: WINDOW_BUDGET_SCHEMA_VERSION,
      contextWindowTokens,
      mode,
    });
    const bandAssert = assertWindowBand({
      contextWindowTokens: policy.contextWindowTokens,
      policy,
    });
    const split = splitPlanExecuteBudgets({
      maxModelCalls: policy.run.maxModelCalls,
      hardMaxModelCalls: policy.run.hardMaxModelCalls,
      maxToolCalls: policy.run.maxToolCalls,
      hardMaxToolCalls: policy.run.hardMaxToolCalls,
    });
    ctx.store.setSlice("windowPolicy", policy);
    ctx.store.setSlice("windowBand", {
      ...bandAssert,
      planBudget: split.plan,
      executeBudget: split.execute,
      reasonCodes: [
        ...bandAssert.reasonCodes,
        ...split.reasonCodes,
      ],
    });
    return policy;
  } catch {
    ctx.store.setSlice("windowPolicy", {
      applied: true,
      source: "runtime_fallback",
      contextWindowTokens,
      reasonCodes: ["window_policy_derive_failed"],
    });
    return undefined;
  }
}
