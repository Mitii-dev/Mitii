import {
  HYBRID_RETRIEVAL_DEFAULTS,
  HYBRID_RETRIEVAL_IDS,
} from "../constants";

import {
  retrievalSourceResultSchema,
} from "../schema";

import type {
  HybridRetrievalRankingContext,
  NormalizedHybridRetrievalRequest,
  RetrievalCandidate,
  RetrievalReason,
  RetrievalReasonType,
  RetrievalSource,
  RetrievalSourceResult,
} from "../types";

interface SessionPathHit {
  relativePath: string;
  score: number;
  reasonType: RetrievalReasonType;
  evidence: string;
}

/**
 * Ephemeral session retrieval — open / current / git / recent / diagnostic
 * paths as file candidates without waiting on indexes (Cody / continue style).
 */
export class SessionContextRetrievalSource
  implements RetrievalSource
{
  public readonly id =
    HYBRID_RETRIEVAL_IDS.SESSION_SOURCE;

  public canRetrieve(
    request: NormalizedHybridRetrievalRequest,
  ): boolean {
    return this.collectHits(request.rankingContext).length > 0;
  }

  public async retrieve(
    request: NormalizedHybridRetrievalRequest,
  ): Promise<RetrievalSourceResult> {
    const hits = this.collectHits(request.rankingContext)
      .filter((hit) => this.matchesScope(hit.relativePath, request))
      .sort(
        (left, right) =>
          right.score - left.score ||
          left.relativePath.localeCompare(right.relativePath),
      );

    const candidates: RetrievalCandidate[] = hits.map((hit) =>
      this.toCandidate(hit),
    );

    const truncated =
      candidates.length > request.maximumCandidatesPerSource;

    return this.validate({
      status: candidates.length > 0 ? "complete" : "empty",
      candidates: candidates.slice(
        0,
        request.maximumCandidatesPerSource,
      ),
      truncated,
      warnings: truncated
        ? [
            {
              code: "source_limit_reached",
              message:
                "Session context candidates exceeded the per-source limit.",
            },
          ]
        : [],
    });
  }

  private collectHits(
    context: HybridRetrievalRankingContext | undefined,
  ): SessionPathHit[] {
    if (!context) {
      return [];
    }

    const best = new Map<string, SessionPathHit>();
    const upsert = (hit: SessionPathHit) => {
      const existing = best.get(hit.relativePath);
      if (!existing || hit.score > existing.score) {
        best.set(hit.relativePath, hit);
      }
    };

    if (context.currentFile) {
      upsert({
        relativePath: context.currentFile,
        score: HYBRID_RETRIEVAL_DEFAULTS.SESSION_CURRENT_FILE_SCORE,
        reasonType: "session_current_file",
        evidence: `Current editor file ${context.currentFile}.`,
      });
    }

    for (const relativePath of context.recentEditFiles ?? []) {
      upsert({
        relativePath,
        score: HYBRID_RETRIEVAL_DEFAULTS.SESSION_RECENT_EDIT_SCORE,
        reasonType: "session_recent_edit",
        evidence: `Recently edited file ${relativePath}.`,
      });
    }

    for (const relativePath of context.staleFiles ?? []) {
      upsert({
        relativePath,
        score: HYBRID_RETRIEVAL_DEFAULTS.SESSION_STALE_FILE_SCORE,
        reasonType: "session_stale_file",
        evidence: `Stale on-disk file ${relativePath} (re-read preferred).`,
      });
    }

    for (const relativePath of context.gitDiffFiles ?? []) {
      upsert({
        relativePath,
        score: HYBRID_RETRIEVAL_DEFAULTS.SESSION_GIT_DIFF_SCORE,
        reasonType: "session_git_diff",
        evidence: `Git-dirty file ${relativePath}.`,
      });
    }

    for (const relativePath of context.diagnosticFiles ?? []) {
      upsert({
        relativePath,
        score: HYBRID_RETRIEVAL_DEFAULTS.SESSION_DIAGNOSTIC_SCORE,
        reasonType: "session_diagnostic",
        evidence: `Diagnostic file ${relativePath}.`,
      });
    }

    for (const relativePath of context.openFiles ?? []) {
      upsert({
        relativePath,
        score: HYBRID_RETRIEVAL_DEFAULTS.SESSION_OPEN_FILE_SCORE,
        reasonType: "session_open_file",
        evidence: `Open editor tab ${relativePath}.`,
      });
    }

    return [...best.values()];
  }

  private toCandidate(hit: SessionPathHit): RetrievalCandidate {
    const reason: RetrievalReason = {
      type: hit.reasonType,
      evidence: hit.evidence,
    };

    return {
      entityKind: "file",
      rootId: "root",
      relativePath: hit.relativePath,
      sourceScore: hit.score,
      reasons: [reason],
    };
  }

  private matchesScope(
    relativePath: string,
    request: NormalizedHybridRetrievalRequest,
  ): boolean {
    if (
      request.filePaths.length === 0 &&
      !request.folderPrefix
    ) {
      return true;
    }

    if (request.filePaths.includes(relativePath)) {
      return true;
    }

    return Boolean(
      request.folderPrefix &&
        (relativePath === request.folderPrefix ||
          relativePath.startsWith(`${request.folderPrefix}/`)),
    );
  }

  private validate(
    result: RetrievalSourceResult,
  ): RetrievalSourceResult {
    return retrievalSourceResultSchema.parse(
      result,
    ) as RetrievalSourceResult;
  }
}
