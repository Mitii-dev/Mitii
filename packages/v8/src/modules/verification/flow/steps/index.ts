export {
  mapAffectedProjects,
  languagesForProjects,
} from "./1-map-affected-projects";
export type { AffectedProjectMapping } from "./1-map-affected-projects";

export { discoverApplicableChecks } from "./2-discover-checks";
export type {
  DiscoverApplicableChecksResult,
  DiscoveredCheckCandidate,
} from "./2-discover-checks";

export { selectProportionalChecks } from "./3-select-checks";
export type { SelectProportionalChecksResult } from "./3-select-checks";

export { executeChecks } from "./4-execute-checks";
export type { ExecuteChecksResult } from "./4-execute-checks";

export {
  normalizeDiagnostics,
  packDiagnosticsForModel,
} from "./5-normalize-diagnostics";

export { inspectDiffAndStaleRisk } from "./6-inspect-diff";
export type { InspectDiffAndStaleRiskResult } from "./6-inspect-diff";

export { recommendCompletion } from "./7-recommend-completion";
export type { CompletionRecommendation } from "./7-recommend-completion";

export { captureRepoBuildState } from "./8-capture-build-state";

export { buildVerificationRecord } from "./9-build-record";
export type { BuildVerificationRecordParams } from "./9-build-record";

export {
  buildVerificationUserSummary,
  formatOptionalLeftoverOffer,
} from "./10-build-user-summary";

export { filterActionableDiagnostics } from "../../helpers/FilterActionableDiagnostics";
export type { FilterActionableDiagnosticsResult } from "../../helpers/FilterActionableDiagnostics";

export {
  assessTaskRelevantEvidence,
  projectLocalCompilePassed,
  selectAskScopedDefects,
} from "../../helpers/AssessTaskRelevantEvidence";
export type {
  TaskRelevantEvidenceAssessment,
  TaskRelevantResidualKind,
} from "../../helpers/AssessTaskRelevantEvidence";

export {
  BEHAVIOR_EVIDENCE_KIND,
  hasBehaviorDefect,
  hasPassedBehaviorCheck,
  isBehaviorDefectCheck,
  isEmptyTestSuiteSummary,
  requiresBehaviorEvidence,
} from "../../helpers/BehaviorEvidence";

export { diagnosticIdentityKey } from "../../helpers/diagnosticIdentity";

export { compareRepoBuildStates } from "../../helpers/compareRepoBuildStates";
