export {
  VERIFICATION_SCHEMA_VERSION,
  VERIFICATION_STATUSES,
  VERIFICATION_CHECK_KINDS,
  VERIFICATION_CHECK_OUTCOMES,
  VERIFICATION_CHANGE_SCOPES,
  VERIFICATION_DIAGNOSTIC_SEVERITIES,
  VERIFICATION_REASON_CODES,
  VERIFICATION_REASON,
  VERIFICATION_ERROR_CODES,
  VERIFICATION_MESSAGES,
  VERIFICATION_STAGES,
  VERIFICATION_RECORD_SCHEMA_VERSION,
  VERIFICATION_RECORD_STATUSES,
  VERIFICATION_RECORD_REASON_CODES,
} from "./constants";
export type { VerificationStageName } from "./constants";

export {
  DEFAULT_MAX_CHECKS,
  DEFAULT_MAX_DIAGNOSTICS,
  DEFAULT_MAX_DIAGNOSTICS_PER_FILE,
  DEFAULT_DIFF_PREVIEW_CHARS,
  DEFAULT_SUMMARY_DIAGNOSTICS,
  DEFAULT_SUMMARY_CHARS,
} from "./defaults";

export { VerificationPipeline } from "./flow/VerificationPipeline";
export type {
  VerificationPipelineDependencies,
  VerificationPipelineOptions,
} from "./flow/VerificationPipeline";

export {
  verificationInputSchema,
  verificationChangeScopeSchema,
  verificationResultSchema,
  verificationStatusSchema,
  verificationCheckKindSchema,
  verificationCheckOutcomeSchema,
  verificationDiagnosticSeveritySchema,
  verificationReasonCodeSchema,
  verificationDiagnosticSchema,
  verificationCheckResultSchema,
  verificationDiffInspectionSchema,
  REPO_BUILD_STATE_SCHEMA_VERSION,
  repoBuildStateSchema,
  repoBuildStateComparisonReasonSchema,
  repoBuildStateComparisonSchema,
  verificationRecordSchema,
  verificationRecordStatusSchema,
  verificationRecordReasonCodeSchema,
  verificationErrorCodeSchema,
  VerificationError,
} from "./contracts";
export type {
  VerificationInput,
  VerificationChangeScope,
  VerificationResult,
  VerificationStatus,
  VerificationCheckKind,
  VerificationCheckOutcome,
  VerificationDiagnosticSeverity,
  VerificationReasonCode,
  VerificationDiagnostic,
  VerificationCheckResult,
  VerificationDiffInspection,
  RepoBuildState,
  RepoBuildStateComparison,
  RepoBuildStateComparisonReason,
  VerificationRecord,
  VerificationRecordStatus,
  VerificationRecordReasonCode,
  VerificationErrorCode,
  VerificationToolExecutorPort,
  VerificationManifestReaderPort,
  VerificationSyntaxPort,
  VerificationSyntaxFinding,
  VerificationRecordStorePort,
  ModuleLoggerPort,
} from "./contracts";

export {
  SYNTAX_PORT_EVIDENCE,
  NODE_MODULE_LOAD_EVIDENCE,
  noopModuleLogger,
} from "./contracts";

export {
  buildVerificationRecord,
  buildVerificationUserSummary,
  formatOptionalLeftoverOffer,
} from "./records";

export {
  packDiagnosticsForModel,
  filterActionableDiagnostics,
  assessTaskRelevantEvidence,
  projectLocalCompilePassed,
  selectAskScopedDefects,
  BEHAVIOR_EVIDENCE_KIND,
  hasBehaviorDefect,
  hasPassedBehaviorCheck,
  isBehaviorDefectCheck,
  requiresBehaviorEvidence,
  diagnosticIdentityKey,
  compareRepoBuildStates,
} from "./flow/steps";
export type {
  FilterActionableDiagnosticsResult,
  TaskRelevantEvidenceAssessment,
  TaskRelevantResidualKind,
  CompletionRecommendation,
} from "./flow/steps";

export {
  VERIFICATION_DENIED_PATH_SEGMENTS,
  isDeniedDiagnosticPath,
  isHarnessFrameDiagnostic,
  isPhantomSecondaryDiagnostic,
  isWorkspaceRootCheckId,
  normalizeVerificationPath,
} from "./rules/patterns";

export {
  InMemoryManifestReader,
  WorkspaceFileSystemManifestReader,
  InMemoryVerificationRecordStore,
  FileVerificationRecordStore,
} from "./adapters";
