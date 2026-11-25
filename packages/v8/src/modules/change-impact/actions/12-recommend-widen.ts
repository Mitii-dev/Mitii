import { CHANGE_IMPACT_REASON } from "../constants";
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
  if (result.reasonCodes.includes(CHANGE_IMPACT_REASON.graphConfidenceUnsafe)) {
    return true;
  }
  if (result.reasonCodes.includes(CHANGE_IMPACT_REASON.graphStale)) return true;
  if (result.reasonCodes.includes(CHANGE_IMPACT_REASON.seedCycleDetected)) {
    return true;
  }
  if (result.reasonCodes.includes(CHANGE_IMPACT_REASON.hiddenCouplingDetected)) {
    return true;
  }
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
    result.reasonCodes.includes(CHANGE_IMPACT_REASON.graphConfidenceUnsafe)
  );
}
