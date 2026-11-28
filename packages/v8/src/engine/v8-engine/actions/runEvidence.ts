/**
 * Shim — owner is runtime/helpers/run-evidence.
 */
export {
  createInitialRunEvidence,
  finalizeRunEvidence,
  isSuccessfulVerificationToolResult,
  recordBuildStateDeltaEvidence,
  recordDiscoveryEvidence,
  recordPlanEvidence,
  markPlanEvidenceStepsDone,
  recordStopEvidence,
  recordToolEvidence,
  recordVerificationEvidence,
  diagnosticToIssue,
  diagnosticKey,
  mergeIssues,
  issueKey,
  upsertLedgerEntry,
  trimEvidence,
  extractEvidencePaths,
  hasCheckpointOutput,
  isVerificationCommandOutput,
} from "../../../runtime/helpers/run-evidence";
export type { DiscoveryEvidenceCollectorSlice } from "../../../runtime/helpers/run-evidence";
