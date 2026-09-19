import type { WindowBudgetPolicyOverrides } from "./contracts";
import { resolveWindowBudgetPolicy } from "./policy";

/**
 * Continuous tool-loop / execute output ceiling from the advertised context window.
 *
 * Uses the same resolved `outputWindowCapRatio` as planning generation
 * (defaults → window band → optional host overrides). No fixed token table —
 * a 30k window and a 256k window both scale as `floor(W × ratio)`.
 */
export function resolveToolLoopMaxOutputTokens(
  contextWindowTokens: number,
  overrides?: WindowBudgetPolicyOverrides,
): number {
  const resolved = resolveWindowBudgetPolicy({
    contextWindowTokens,
    overrides,
  });
  const window = Math.max(1, resolved.contextWindowTokens);
  const ratio = resolved.policy.outputWindowCapRatio;
  return Math.max(1, Math.floor(window * ratio));
}
