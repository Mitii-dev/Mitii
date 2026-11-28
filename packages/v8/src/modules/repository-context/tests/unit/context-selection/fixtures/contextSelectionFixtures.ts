import type {
  HybridRetrievalCandidate,
  HybridRetrievalResult,
  HybridRetrievalStatus,
} from "../../../../helpers/hybrid-retrieval/types";

export function chunk(
  relativePath: string,
  chunkId: string,
  score: number,
  startLine = 1,
): HybridRetrievalCandidate {
  const reason = {
    type:
      "lexical_match" as const,
    evidence:
      `Matched ${relativePath}.`,
  };

  return {
    key:
      `chunk:${chunkId}`,
    entityKind:
      "chunk",
    rootId:
      "root",
    relativePath,
    chunkId,
    startLine,
    endLine:
      startLine + 10,
    tokenEstimate:
      200,
    fusedScore:
      score,
    score,
    matchedSourceCount:
      1,
    contributions: [
      {
        sourceId:
          "text-index",
        sourceRank:
          1,
        sourceScore:
          score,
        sourceWeight:
          1,
        reciprocalRankScore:
          0.01,
        reasons: [
          reason,
        ],
      },
    ],
    reasons: [
      reason,
    ],
  };
}

export function retrieval(
  candidates:
    HybridRetrievalCandidate[],
  status:
    HybridRetrievalStatus =
    "complete",
): HybridRetrievalResult {
  const isFailure =
    status ===
      "failed" ||
    status ===
      "empty" ||
    status ===
      "cancelled";
  const returned =
    isFailure
      ? []
      : candidates;

  return {
    schemaVersion:
      1,
    query:
      "query",
    status,
    candidates:
      returned,
    sourceReports: [
      {
        sourceId:
          "text-index",
        status:
          status ===
          "failed"
            ? "failed"
            : status ===
                "cancelled"
              ? "cancelled"
              : returned
                    .length >
                  0
                ? "complete"
                : "empty",
        required:
          false,
        weight:
          1,
        candidateCount:
          returned.length,
        truncated:
          false,
        warningCount:
          0,
      },
    ],
    warnings:
      status ===
      "partial"
        ? [
            {
              code:
                "source_failed",
              message:
                "A source failed.",
            },
          ]
        : [],
    truncated:
      false,
    statistics: {
      configuredSources:
        1,
      attemptedSources:
        1,
      successfulSources:
        status ===
          "failed" ||
        status ===
          "cancelled"
          ? 0
          : 1,
      failedSources:
        status ===
          "failed" ||
        status ===
          "cancelled"
          ? 1
          : 0,
      skippedSources:
        0,
      sourceCandidates:
        returned.length,
      uniqueCandidates:
        returned.length,
      duplicateCandidatesRemoved:
        0,
      returnedCandidates:
        returned.length,
    },
  };
}
