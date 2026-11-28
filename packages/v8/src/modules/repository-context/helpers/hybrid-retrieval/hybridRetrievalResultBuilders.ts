import { HYBRID_RETRIEVAL_SCHEMA_VERSION } from "./constants";
import { hybridRetrievalResultSchema } from "./schema";

import type {
  HybridRetrievalCandidate,
  HybridRetrievalResult,
  HybridRetrievalSourceReport,
  HybridRetrievalStatistics,
  HybridRetrievalWarning,
  RetrievalSourceExecutionResult,
} from "./types";

export interface FusionCounts {
  inputCandidates: number;
  uniqueCandidates: number;
  duplicateCandidatesRemoved: number;
}

export function validateHybridResult(
  result: HybridRetrievalResult,
): HybridRetrievalResult {
  return hybridRetrievalResultSchema.parse(result) as HybridRetrievalResult;
}

export function buildSourceReport(
  sourceId: string,
  status: HybridRetrievalSourceReport["status"],
  required: boolean,
  weight: number,
  candidateCount = 0,
  truncated = false,
  warningCount = 0,
): HybridRetrievalSourceReport {
  return {
    sourceId,
    status,
    required,
    weight,
    candidateCount,
    truncated,
    warningCount,
  };
}

export function statisticsFromReports(
  configuredSources: number,
  reports: readonly HybridRetrievalSourceReport[],
  sourceCandidates: number,
  uniqueCandidates: number,
  duplicateCandidatesRemoved: number,
  returnedCandidates = 0,
): HybridRetrievalStatistics {
  return {
    configuredSources,
    attemptedSources: reports.filter((report) => report.status !== "skipped")
      .length,
    successfulSources: reports.filter(
      (report) => report.status === "complete" || report.status === "empty",
    ).length,
    failedSources: reports.filter(
      (report) => report.status === "failed" || report.status === "cancelled",
    ).length,
    skippedSources: reports.filter((report) => report.status === "skipped")
      .length,
    sourceCandidates,
    uniqueCandidates,
    duplicateCandidatesRemoved,
    returnedCandidates,
  };
}

export function buildStatistics(
  configuredSources: number,
  executions: readonly RetrievalSourceExecutionResult[],
  sourceCandidates: number,
  uniqueCandidates: number,
  duplicateCandidatesRemoved: number,
  returnedCandidates = 0,
): HybridRetrievalStatistics {
  return statisticsFromReports(
    configuredSources,
    executions.map((execution) => execution.report),
    sourceCandidates,
    uniqueCandidates,
    duplicateCandidatesRemoved,
    returnedCandidates,
  );
}

export function buildFailedResult(
  query: string,
  executions: readonly RetrievalSourceExecutionResult[],
  warnings: HybridRetrievalWarning[],
  fusion?: FusionCounts,
): HybridRetrievalResult {
  return validateHybridResult({
    schemaVersion: HYBRID_RETRIEVAL_SCHEMA_VERSION,
    query,
    status: "failed",
    candidates: [],
    sourceReports: executions.map((execution) => execution.report),
    warnings,
    truncated: false,
    statistics: buildStatistics(
      executions.length,
      executions,
      fusion?.inputCandidates ?? 0,
      fusion?.uniqueCandidates ?? 0,
      fusion?.duplicateCandidatesRemoved ?? 0,
    ),
  });
}

export function buildCancelledResult(
  query: string,
  sourceReports: HybridRetrievalSourceReport[],
  warnings: HybridRetrievalWarning[] = [],
): HybridRetrievalResult {
  return validateHybridResult({
    schemaVersion: HYBRID_RETRIEVAL_SCHEMA_VERSION,
    query,
    status: "cancelled",
    candidates: [],
    sourceReports,
    warnings,
    truncated: false,
    statistics: statisticsFromReports(
      sourceReports.length,
      sourceReports,
      0,
      0,
      0,
    ),
  });
}

export function sortHybridCandidates(
  candidates: HybridRetrievalCandidate[],
): void {
  candidates.sort(
    (left, right) =>
      right.score - left.score ||
      right.matchedSourceCount - left.matchedSourceCount ||
      left.key.localeCompare(right.key),
  );
}

export function clampUnit(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
