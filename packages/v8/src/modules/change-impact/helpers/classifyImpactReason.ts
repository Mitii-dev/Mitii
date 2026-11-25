import type { ChangeImpactFileReason } from "../types";
import type { ChangeImpactEdgeType } from "./impactTypes";

const PACKAGE_EDGE_TYPES = new Set<ChangeImpactEdgeType>([
  "depends_on",
  "development_depends_on",
]);

/**
 * Map walk hop + edge type into a stable, auditable impact reason code.
 */
export function classifyImpactReason(params: {
  hop: number;
  viaEdgeType: ChangeImpactEdgeType;
}): ChangeImpactFileReason {
  if (params.viaEdgeType === "workspace_member") {
    return "workspace_member";
  }
  if (PACKAGE_EDGE_TYPES.has(params.viaEdgeType)) {
    return "package";
  }
  if (params.hop <= 1) {
    return "direct";
  }
  return "transitive";
}

export function describeImpactReason(params: {
  impactReason: ChangeImpactFileReason;
  viaEdgeType: ChangeImpactEdgeType;
  hop: number;
}): string {
  switch (params.impactReason) {
    case "direct":
      return `${params.viaEdgeType} dependent at hop ${params.hop}`;
    case "transitive":
      return `transitive ${params.viaEdgeType} at hop ${params.hop}`;
    case "package":
      return `package ${params.viaEdgeType} at hop ${params.hop}`;
    case "workspace_member":
      return `workspace member at hop ${params.hop}`;
    case "navigation_enrichment":
      return `${params.viaEdgeType} via code-navigation enrichment`;
    case "identity_overlay":
      return `path identity overlay at hop ${params.hop}`;
    case "historical_coupling":
      return `capped historical co-change at hop ${params.hop}`;
    case "hidden_coupling":
      return `hidden coupling (co-change without structural edge) at hop ${params.hop}`;
  }
}
