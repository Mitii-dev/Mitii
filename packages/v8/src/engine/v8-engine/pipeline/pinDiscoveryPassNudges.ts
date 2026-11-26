/**
 * Discovery-pass quality / symbol / search nudge copy (plan quality floor).
 */

export function buildDiscoveryQualityFloorNudge(params: {
  thoroughEvidence: boolean;
  preferSymbolEvidence: boolean;
}): string {
  if (!params.thoroughEvidence) {
    return "Plan quality floor: before finishing, read at least one concrete source/config file that discovery identified.";
  }
  if (params.preferSymbolEvidence) {
    return "Plan quality floor (thorough): before finishing, read at least two productive source files (not package.json/lockfiles), search for related callers/tests, call document_symbol or goto_definition on entrypoints to attach key symbols, and identify change surfaces.";
  }
  return "Plan quality floor (thorough): before finishing, read at least two productive source files (not package.json/lockfiles), search for related callers/tests, and identify key functions/symbols plus change surfaces.";
}

export const DISCOVERY_SYMBOL_EVIDENCE_NUDGE =
  "Symbol evidence still missing: call document_symbol or goto_definition on an entrypoint already read (or a preferred path) before finishing discovery.";

export const DISCOVERY_SEARCH_EVIDENCE_NUDGE =
  "Search evidence still missing: call search_files or glob_files for related callers, tests, or imports before finishing discovery.";

export function buildDiscoveryFailureWarning(params: {
  qualityFloor: boolean;
  thoroughEvidence: boolean;
}): string {
  if (!params.qualityFloor) {
    return "Discovery did not identify a concrete change surface. The plan lists open questions instead of invented file tasks.";
  }
  if (params.thoroughEvidence) {
    return "Thorough plan discovery did not gather multi-file change surfaces and symbols. Ask clarifying questions instead of inventing a hollow plan.";
  }
  return "Plan discovery did not gather file-backed change surfaces. Ask clarifying questions instead of inventing a hollow plan.";
}
