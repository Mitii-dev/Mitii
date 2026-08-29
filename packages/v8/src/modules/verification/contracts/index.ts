export {
  verificationInputSchema,
  verificationChangeScopeSchema,
} from "./input/VerificationInput";
export type {
  VerificationInput,
  VerificationChangeScope,
} from "./input/VerificationInput";

export {
  verificationResultSchema,
  verificationStatusSchema,
  verificationCheckKindSchema,
  verificationCheckOutcomeSchema,
  verificationDiagnosticSeveritySchema,
  verificationReasonCodeSchema,
  verificationDiagnosticSchema,
  verificationCheckResultSchema,
  verificationDiffInspectionSchema,
} from "./output/VerificationResult";
export type {
  VerificationResult,
  VerificationStatus,
  VerificationCheckKind,
  VerificationCheckOutcome,
  VerificationDiagnosticSeverity,
  VerificationReasonCode,
  VerificationDiagnostic,
  VerificationCheckResult,
  VerificationDiffInspection,
} from "./output/VerificationResult";

export {
  REPO_BUILD_STATE_SCHEMA_VERSION,
  repoBuildStateSchema,
  repoBuildStateComparisonReasonSchema,
  repoBuildStateComparisonSchema,
} from "./output/RepoBuildState";
export type {
  RepoBuildState,
  RepoBuildStateComparison,
  RepoBuildStateComparisonReason,
} from "./output/RepoBuildState";

export {
  verificationErrorCodeSchema,
  VerificationError,
} from "./errors/VerificationErrors";
export type { VerificationErrorCode } from "./errors/VerificationErrors";

export type {
  VerificationToolExecutorPort,
  VerificationManifestReaderPort,
} from "./ports/VerificationPorts";

export {
  verificationRecordSchema,
  verificationRecordStatusSchema,
  verificationRecordReasonCodeSchema,
} from "./output/VerificationRecord";
export type {
  VerificationRecord,
  VerificationRecordStatus,
  VerificationRecordReasonCode,
} from "./output/VerificationRecord";

export type { VerificationRecordStorePort } from "./ports/VerificationRecordStorePort";
