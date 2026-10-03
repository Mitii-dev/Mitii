export { mapAffectedProjects, languagesForProjects } from "./MapAffectedProjects";
export type { AffectedProjectMapping } from "./MapAffectedProjects";

export { discoverApplicableChecks } from "./DiscoverApplicableChecks";
export type {
  DiscoverApplicableChecksResult,
  DiscoveredCheckCandidate,
} from "./DiscoverApplicableChecks";

export { selectProportionalChecks } from "./SelectProportionalChecks";
export type { SelectProportionalChecksResult } from "./SelectProportionalChecks";

export { executeChecks } from "./ExecuteChecks";
export type { ExecuteChecksResult } from "./ExecuteChecks";

export { normalizeDiagnostics, packDiagnosticsForModel } from "./NormalizeDiagnostics";

export { filterActionableDiagnostics } from "./FilterActionableDiagnostics";
export type { FilterActionableDiagnosticsResult } from "./FilterActionableDiagnostics";

export {
  assessTaskRelevantEvidence,
  projectLocalCompilePassed,
  selectAskScopedDefects,
} from "./AssessTaskRelevantEvidence";
export type {
  TaskRelevantEvidenceAssessment,
  TaskRelevantResidualKind,
} from "./AssessTaskRelevantEvidence";

export { diagnosticIdentityKey } from "./diagnosticIdentity";

export { inspectDiffAndStaleRisk } from "./InspectDiffAndStaleRisk";
export type { InspectDiffAndStaleRiskResult } from "./InspectDiffAndStaleRisk";

export { recommendCompletion } from "./RecommendCompletion";
export type { CompletionRecommendation } from "./RecommendCompletion";

export { captureRepoBuildState } from "./CaptureRepoBuildState";
export { compareRepoBuildStates } from "./CompareRepoBuildStates";
export { buildVerificationRecord } from "./BuildVerificationRecord";
export type { BuildVerificationRecordParams } from "./BuildVerificationRecord";
export { buildVerificationUserSummary, formatOptionalLeftoverOffer } from "./BuildVerificationUserSummary";
