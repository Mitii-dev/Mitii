export {
  VERIFICATION_SCHEMA_VERSION,
  VERIFICATION_STATUSES,
  VERIFICATION_CHECK_KINDS,
  VERIFICATION_CHECK_OUTCOMES,
  VERIFICATION_CHANGE_SCOPES,
  VERIFICATION_DIAGNOSTIC_SEVERITIES,
  VERIFICATION_REASON_CODES,
  VERIFICATION_ERROR_CODES,
} from "./constants";

export {
  DEFAULT_MAX_CHECKS,
  DEFAULT_MAX_DIAGNOSTICS,
  DEFAULT_DIFF_PREVIEW_CHARS,
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
  VerificationErrorCode,
  VerificationToolExecutorPort,
  VerificationManifestReaderPort,
} from "./contracts";

export { InMemoryManifestReader, NodeManifestReader } from "./adapters";
