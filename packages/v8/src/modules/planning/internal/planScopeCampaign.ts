/**
 * Multi-phase campaign handoff after an A/B/C scope phase completes.
 */

import type { PlanScopeId } from "./planScopeChoice";
import { PLAN_SCOPE_DEFS, PLAN_SCOPE_ORDER } from "./planScopeChoice";

export function remainingPlanScopeIds(
  completed: readonly PlanScopeId[],
): PlanScopeId[] {
  const done = new Set(completed);
  return PLAN_SCOPE_ORDER.filter((id) => !done.has(id));
}

export function formatNextPlanPhaseOffer(params: {
  completedScopeId: PlanScopeId;
  remaining: readonly PlanScopeId[];
}): string | undefined {
  if (params.remaining.length === 0) {
    return undefined;
  }
  const done = PLAN_SCOPE_DEFS[params.completedScopeId];
  const lines = params.remaining.map((id) => {
    const def = PLAN_SCOPE_DEFS[id];
    return `- ${def.letter}) ${def.label} — ${def.detail}`;
  });
  return [
    "## Next phase available",
    "",
    `This phase locked scope ${done.letter} (${done.label}). Remaining campaign scopes:`,
    ...lines,
    "",
    "Say which scope to tackle next when you are ready.",
  ].join("\n");
}

/** Append a next-phase offer to a terminal answer (idempotent). */
export function appendNextPlanPhaseOffer(
  answer: string,
  offer: string | undefined,
): string {
  const trimmedOffer = offer?.trim();
  if (!trimmedOffer) {
    return answer;
  }
  const base = answer.trim();
  if (!base) {
    return trimmedOffer;
  }
  if (base.includes("## Next phase available")) {
    return base;
  }
  return `${base}\n\n${trimmedOffer}`;
}
