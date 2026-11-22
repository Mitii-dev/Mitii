import type { ChangeImpactResult } from "../contracts";

/**
 * Consumers (verification / tool runtime) should widen check scope when the
 * published graph cannot be trusted for a narrow proportional selection.
 */
export function recommendWidenVerification(
  result: Pick<
    ChangeImpactResult,
    "graphConfidenceUnsafe" | "reasonCodes" | "status" | "blastRadius"
  >,
): boolean {
  if (result.graphConfidenceUnsafe) return true;
  if (result.reasonCodes.includes("graph_confidence_unsafe")) return true;
  if (result.reasonCodes.includes("graph_stale")) return true;
  if (result.reasonCodes.includes("seed_cycle_detected")) return true;
  if (result.reasonCodes.includes("hidden_coupling_detected")) return true;
  if (result.status === "partial" && result.blastRadius.level === "high") {
    return true;
  }
  if (result.blastRadius.riskTier === "critical") return true;
  return false;
}

export function isGraphConfidenceUnsafe(
  result: Pick<ChangeImpactResult, "graphConfidenceUnsafe" | "reasonCodes">,
): boolean {
  return (
    result.graphConfidenceUnsafe ||
    result.reasonCodes.includes("graph_confidence_unsafe")
  );
}
