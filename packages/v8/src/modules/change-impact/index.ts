export {
  CHANGE_IMPACT_SCHEMA_VERSION,
  CHANGE_IMPACT_STATUSES,
  CHANGE_IMPACT_DIRECTIONS,
  CHANGE_IMPACT_SEED_EXPANSIONS,
  CHANGE_IMPACT_FILE_BUCKETS,
  CHANGE_IMPACT_EDGE_TYPES,
  CHANGE_IMPACT_REASON_CODES,
  CHANGE_IMPACT_ERROR_CODES,
  CHANGE_IMPACT_WARNING_CODES,
} from "./constants";

export {
  DEFAULT_CHANGE_IMPACT_MAXIMUM_HOPS,
  DEFAULT_CHANGE_IMPACT_MAXIMUM_AFFECTED_NODES,
  DEFAULT_CHANGE_IMPACT_MAXIMUM_PACKAGES,
  DEFAULT_CHANGE_IMPACT_MAXIMUM_EVIDENCE_PER_NODE,
  DEFAULT_CHANGE_IMPACT_MAXIMUM_PATHS,
  DEFAULT_CHANGE_IMPACT_SEED_EXPANSION,
  DEFAULT_CHANGE_IMPACT_FAN_IN_WEIGHT,
  DEFAULT_CHANGE_IMPACT_FAN_IN_CAP,
  DEFAULT_CHANGE_IMPACT_EVIDENCE_WEIGHT,
  DEFAULT_CHANGE_IMPACT_EVIDENCE_CAP,
  DEFAULT_CHANGE_IMPACT_TEST_SCORE_FACTOR,
  DEFAULT_CHANGE_IMPACT_PAGE_RANK_WEIGHT,
  DEFAULT_CHANGE_IMPACT_PAGE_RANK_CAP,
  DEFAULT_CHANGE_IMPACT_LSP_ENRICH_MAX_FILES,
  DEFAULT_CHANGE_IMPACT_MODEL_FACING_AFFECTED_NODES,
  DEFAULT_CHANGE_IMPACT_MODEL_FACING_EVIDENCE_PER_NODE,
  DEFAULT_CHANGE_IMPACT_MODEL_FACING_AFFECTED_FILES,
  DEFAULT_CHANGE_IMPACT_MODEL_FACING_CHAINS,
} from "./defaults";

export { CHANGE_IMPACT_POLICY } from "./policy";

export {
  compactChangeImpactForModelFacing,
  isChangeImpactToolOutput,
} from "./actions/compactChangeImpactForModelFacing";
export type {
  ModelFacingAffectedNode,
  ModelFacingAffectedFile,
  ModelFacingPackage,
  ModelFacingChain,
  ModelFacingChainLink,
} from "./actions/compactChangeImpactForModelFacing";

export {
  mergeNavigationEnrichment,
} from "./actions/mergeNavigationEnrichment";
export type { NavigationEnrichmentLocation } from "./actions/mergeNavigationEnrichment";

export {
  classifyImpactBucket,
  bucketSortKey,
} from "./internal/classifyImpactBucket";
export type { ChangeImpactFileBucket as ImpactPathBucket } from "./internal/classifyImpactBucket";

export { resolveSoftSymbolMatches } from "./internal/resolveSoftSymbolMatches";

export { collapseChainPrefixes } from "./internal/collectBoundedChains";

export { ChangeImpactPipeline } from "./pipeline/ChangeImpactPipeline";
export {
  changeImpactInputSchema,
  changeImpactSeedSchema,
  changeImpactFileSeedSchema,
  changeImpactSymbolSeedSchema,
  changeImpactCaretSeedSchema,
  changeImpactEdgeTypeSchema,
  changeImpactDirectionSchema,
  changeImpactSeedExpansionSchema,
  changeImpactResultSchema,
  changeImpactStatusSchema,
  changeImpactReasonCodeSchema,
  changeImpactWarningCodeSchema,
  changeImpactFileBucketSchema,
  changeImpactResolvedSeedSchema,
  changeImpactAffectedNodeSchema,
  changeImpactAffectedFileSchema,
  changeImpactDirectNeighborCountsSchema,
  changeImpactChainLinkSchema,
  changeImpactChainSchema,
  changeImpactPackageSchema,
  changeImpactWarningSchema,
  ChangeImpactError,
  changeImpactErrorCodeSchema,
} from "./contracts";
export type {
  ChangeImpactInput,
  ChangeImpactParsedInput,
  ChangeImpactSeed,
  ChangeImpactResult,
  ChangeImpactStatus,
  ChangeImpactReasonCode,
  ChangeImpactWarningCode,
  ChangeImpactErrorCode,
  ChangeImpactFileBucket,
} from "./contracts";
