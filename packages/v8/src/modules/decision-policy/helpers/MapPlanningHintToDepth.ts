import type { PlanningDepth } from "../contracts";

/**
 * Ballot planningHint → DP planningDepth vocabulary (§5.7 / S2-DP-PLAN).
 * Mode/route plates may still override (e.g. plan mode → visible).
 */
export function mapPlanningHintToDepth(
  hint: "none" | "short" | "medium" | "long",
): PlanningDepth {
  switch (hint) {
    case "long":
      return "visible";
    case "medium":
    case "short":
      return "internal";
    case "none":
    default:
      return "none";
  }
}
