import { CHANGE_IMPACT_POLICY } from "../rules";
import type { ChangeImpactEdgeType } from "./impactTypes";

/**
 * When package impact is requested, ensure package/workspace edges participate
 * even if the caller left edgeTypes at the structural default.
 */
export function resolveEffectiveEdgeTypes(params: {
  edgeTypes: readonly ChangeImpactEdgeType[];
  includePackages: boolean;
}): ChangeImpactEdgeType[] {
  if (!params.includePackages) {
    return [...params.edgeTypes];
  }

  const merged = new Set<ChangeImpactEdgeType>(params.edgeTypes);
  for (const edgeType of CHANGE_IMPACT_POLICY.packageEdgeTypes) {
    merged.add(edgeType);
  }
  return [...merged];
}
