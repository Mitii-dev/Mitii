import type { GatePhase } from "./constants";
import { predicatesForPhase } from "./catalog";
import type { GateVerdict } from "./kinds";
import type { GateContext } from "./types";

/**
 * Walk the phase catalog; first matching verdict wins (§10.5).
 */
export function evaluateGates(
  phase: GatePhase,
  ctx: Omit<GateContext, "phase">,
): GateVerdict | undefined {
  const full: GateContext = { ...ctx, phase };
  const predicates = predicatesForPhase(phase, {
    enableExtendedGates: full.enableExtendedGates,
  });
  for (const predicate of predicates) {
    const verdict = predicate(full);
    if (verdict) {
      return verdict;
    }
  }
  return undefined;
}
