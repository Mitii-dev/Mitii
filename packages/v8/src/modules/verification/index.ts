export {
  VERIFICATION_SCHEMA_VERSION,
  VERIFICATION_STATUSES,
  VERIFICATION_CHECK_KINDS,
  VERIFICATION_CHECK_OUTCOMES,
  VERIFICATION_CHANGE_SCOPES,
  VERIFICATION_DIAGNOSTIC_SEVERITIES,
  VERIFICATION_REASON_CODES,
  VERIFICATION_ERROR_CODES,
  VERIFICATION_RECORD_SCHEMA_VERSION,
  VERIFICATION_RECORD_STATUSES,
  VERIFICATION_RECORD_REASON_CODES,
} from "./constants";

export {
  DEFAULT_MAX_CHECKS,
  DEFAULT_MAX_DIAGNOSTICS,
  DEFAULT_DIFF_PREVIEW_CHARS,
  DEFAULT_SUMMARY_DIAGNOSTICS,
  DEFAULT_SUMMARY_CHARS,
} from "./defaults";

export { VerificationPipeline } from "./pipeline/VerificationPipeline";
export type {
  VerificationPipelineDependencies,
  VerificationPipelineOptions,
} from "./pipeline/VerificationPipeline";

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
  VerificationRecordStorePort,
} from "./contracts";

export {
  buildVerificationRecord,
  buildVerificationUserSummary,
} from "./records";

export {
  InMemoryManifestReader,
  WorkspaceFileSystemManifestReader,
  InMemoryVerificationRecordStore,
  FileVerificationRecordStore,
} from "./adapters";
