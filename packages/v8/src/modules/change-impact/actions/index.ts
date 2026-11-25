export { assessChangeImpactGraph } from "./1-assess-graph";
export { resolveChangeImpactSeeds } from "./2-resolve-seeds";
export { walkChangeImpact } from "./3-walk-impact";
export { applyChangeImpactCouplingCycles } from "./4-apply-coupling-cycles";
export {
  finalizeChangeImpactResult,
  buildEmptyChangeImpactResult,
} from "./5-finalize-result";
export { analyzeManyChangeImpact } from "./6-analyze-many";
export { mergeChangeImpactResults } from "./7-merge-results";
export {
  evaluateSpillover,
  spilloverTokensFromResult,
} from "./8-evaluate-spillover";
export { planCheckChangeImpact } from "./9-plan-check";
export { mergeNavigationEnrichment } from "./10-merge-navigation-enrichment";
export type { NavigationEnrichmentLocation } from "./10-merge-navigation-enrichment";
export {
  compactChangeImpactForModelFacing,
  isChangeImpactToolOutput,
} from "./11-compact-model-facing";
export type {
  ModelFacingAffectedNode,
  ModelFacingAffectedFile,
  ModelFacingPackage,
  ModelFacingChain,
  ModelFacingChainLink,
} from "./11-compact-model-facing";
export {
  recommendWidenVerification,
  isGraphConfidenceUnsafe,
} from "./12-recommend-widen";
