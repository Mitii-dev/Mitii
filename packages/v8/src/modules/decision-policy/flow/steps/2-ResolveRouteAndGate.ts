/**
 * Stage 2 — Resolve Route & Gate (S2C-FLOW).
 * Absorbs: plan-route (planning depth, plan gate, anti-nag, clarify).
 */

import { planDecisionRoute } from "./2-plan-route";

export function resolveRouteAndGate(
  ...args: Parameters<typeof planDecisionRoute>
) {
  return planDecisionRoute(...args);
}
