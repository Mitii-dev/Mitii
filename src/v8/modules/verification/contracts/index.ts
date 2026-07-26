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
  verificationErrorCodeSchema,
  VerificationError,
} from "./errors/VerificationErrors";
export type { VerificationErrorCode } from "./errors/VerificationErrors";

export type {
  VerificationToolExecutorPort,
  VerificationManifestReaderPort,
} from "./ports/VerificationPorts";
