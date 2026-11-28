import { WINDOW_BUDGET_STAGES } from "../../constants";
import type { WindowBudgetStageTrace } from "../../contracts";
import {
  resolveWindowBudgetPolicy,
  type ResolveWindowBudgetPolicyInput,
  type ResolvedWindowBudgetPolicy,
} from "../../rules";

/**
 * Flow step 1: merge defaults → band → model profile → mode → lab overrides.
 */
export function resolvePolicyStep(
  input: ResolveWindowBudgetPolicyInput,
): {
  resolved: ResolvedWindowBudgetPolicy;
  stage: WindowBudgetStageTrace;
} {
  const startedMs = Date.now();
  const resolved = resolveWindowBudgetPolicy(input);
  return {
    resolved,
    stage: {
      name: WINDOW_BUDGET_STAGES.resolvePolicy,
      durationMs: Date.now() - startedMs,
      reasonCodes: [],
    },
  };
}
