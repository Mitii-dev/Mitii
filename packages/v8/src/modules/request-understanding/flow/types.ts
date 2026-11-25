import type { DiagnosticSummary } from "../contracts";
import type { ProjectFingerprint } from "../helpers/intent/evidence/UnderstandingEvidencePack";

export interface RequestUnderstandingOptions {
  diagnosticSummary?: DiagnosticSummary;
  /**
   * Optional workspace-relative paths (repo-map / catalog) for fuzzy file
   * target resolution after explicit extraction.
   */
  candidateRelativePaths?: readonly string[];
  /** Engine-supplied short history for the Officer — not a full transcript. */
  historyDigest?: string;
  priorRoute?: string;
  priorTaskSize?: "small" | "medium" | "large";
  /** Host MCP servers relevant to this turn. */
  requiredMcpServerIds?: readonly string[];
  /** Optional catalog/host project fingerprint for the Officer evidence pack. */
  projectFingerprint?: ProjectFingerprint;
}
