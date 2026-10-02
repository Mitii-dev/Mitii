import {
  HYBRID_RETRIEVAL_DEFAULTS,
  HYBRID_RETRIEVAL_IDS,
} from "../constants";

import {
  retrievalSourceResultSchema,
} from "../schema";

import {
  RepoMapRanker,
} from "../../../../repository-state/index";

import type {
  RepoMapEntry,
  RepoMapRankingContext,
} from "../../../../repository-state/index";

import type {
  NormalizedHybridRetrievalRequest,
  RetrievalCandidate,
  RetrievalSource,
  RetrievalSourceResult,
} from "../types";

export class RepoMapRetrievalSource
  implements RetrievalSource
{
  public readonly id =
    HYBRID_RETRIEVAL_IDS
      .REPO_MAP_SOURCE;

  constructor(
    private readonly ranker =
      new RepoMapRanker(),
  ) {}

  public canRetrieve(
    request:
      NormalizedHybridRetrievalRequest,
  ): boolean {
    const hasPublishedMap =
      request.repoMap !==
        undefined &&
      request.repoMap.entries
        .length > 0;
    const canQueryRank =
      request.repoGraph !==
      undefined;

    if (
      !hasPublishedMap &&
      !canQueryRank
    ) {
      return false;
    }

    return (
      request.kinds.length ===
        0 ||
      request.kinds.includes(
        "code_symbol",
      ) ||
      request.kinds.includes(
        "code_region",
      )
    );
  }

  public async retrieve(
    request:
      NormalizedHybridRetrievalRequest,
  ): Promise<RetrievalSourceResult> {
    const entries =
      this.resolveEntries(
        request,
      );

    if (entries.length === 0) {
      return this.validate({
        status: "empty",
        candidates: [],
        truncated: false,
        warnings: [],
      });
    }

    const matching =
      entries.filter(
        (entry) =>
          this.matchesScope(
            entry,
            request,
          ),
      );

    const maximumScore =
      Math.max(
        1,
        ...matching.map(
          (entry) =>
            Math.max(
              0,
              entry.score,
            ),
        ),
      );

    const candidates:
      RetrievalCandidate[] =
      matching
        .map(
          (entry) =>
            this.toCandidate(
              entry,
              maximumScore,
            ),
        )
        .sort(
          (left, right) =>
            right.sourceScore -
              left.sourceScore ||
            left.relativePath
              .localeCompare(
                right.relativePath,
              ),
        );

    const truncated =
      candidates.length >
      request
        .maximumCandidatesPerSource;

    return this.validate({
      status:
        candidates.length > 0
          ? "complete"
          : "empty",
      candidates:
        candidates.slice(
          0,
          request
            .maximumCandidatesPerSource,
        ),
      truncated,
      warnings:
        truncated
          ? [
              {
                code:
                  "source_limit_reached",
                message:
                  "Repo Map candidates exceeded the per-source limit.",
              },
            ]
          : [],
    });
  }

  /**
   * Prefer query-time personalized ranking when a graph is available.
   * Fall back to the published index-time map when graph is missing.
   */
  private resolveEntries(
    request:
      NormalizedHybridRetrievalRequest,
  ): readonly RepoMapEntry[] {
    if (request.repoGraph) {
      const ranking =
        this.ranker.rank({
          graph: request.repoGraph,
          context:
            this.toRankingContext(
              request,
            ),
        });
      return ranking.entries;
    }

    return request.repoMap?.entries ?? [];
  }

  private toRankingContext(
    request:
      NormalizedHybridRetrievalRequest,
  ): RepoMapRankingContext {
    const session =
      request.rankingContext;

    return {
      query: request.query,
      ...(request.rootIds.length > 0
        ? { rootIds: request.rootIds }
        : {}),
      ...(request.folderPrefix
        ? { folderPrefix: request.folderPrefix }
        : {}),
      ...(session?.currentFile
        ? { currentFile: session.currentFile }
        : {}),
      ...(session?.openFiles?.length
        ? { openFiles: session.openFiles }
        : {}),
      ...(session?.gitDiffFiles?.length
        ? { gitDiffFiles: session.gitDiffFiles }
        : {}),
      ...(session?.diagnosticFiles?.length
        ? {
            diagnosticFiles:
              session.diagnosticFiles,
          }
        : {}),
      ...(() => {
        const recentEditFiles = [
          ...new Set([
            ...(session?.recentEditFiles ??
              []),
            ...(session?.staleFiles ?? []),
          ]),
        ];
        return recentEditFiles.length > 0
          ? { recentEditFiles }
          : {};
      })(),
    };
  }

  private toCandidate(
    entry: RepoMapEntry,
    maximumScore: number,
  ): RetrievalCandidate {
    const evidence =
      entry.reasons
        .slice(
          0,
          HYBRID_RETRIEVAL_DEFAULTS
            .REPO_MAP_MAXIMUM_REASON_EVIDENCE,
        )
        .map(
          (reason) =>
            reason.evidence,
        )
        .join("; ");

    return {
      entityKind:
        "file",
      rootId:
        entry.file.rootId,
      relativePath:
        entry.file
          .relativePath,
      ...(entry.file.contentHash
        ? {
            contentHash:
              entry.file
                .contentHash,
          }
        : {}),
      sourceScore:
        this.clamp(
          Math.max(
            0,
            entry.score,
          ) /
            maximumScore,
        ),
      reasons: [
        {
          type:
            "repo_map_rank",
          evidence:
            evidence ||
            `Repo Map rank for ${entry.file.relativePath}.`,
        },
      ],
    };
  }

  private matchesScope(
    entry: RepoMapEntry,
    request:
      NormalizedHybridRetrievalRequest,
  ): boolean {
    if (
      request.rootIds.length >
        0 &&
      !request.rootIds.includes(
        entry.file.rootId,
      )
    ) {
      return false;
    }

    if (!this.matchesFileScope(entry.file.relativePath, request)) {
      return false;
    }

    return true;
  }

  private matchesFileScope(
    relativePath: string,
    request:
      NormalizedHybridRetrievalRequest,
  ): boolean {
    if (
      request.filePaths.length ===
        0 &&
      !request.folderPrefix
    ) {
      return true;
    }

    if (
      request.filePaths.includes(
        relativePath,
      )
    ) {
      return true;
    }

    return Boolean(
      request.folderPrefix &&
        (relativePath ===
          request.folderPrefix ||
          relativePath.startsWith(
            `${request.folderPrefix}/`,
          )),
    );
  }

  private clamp(
    value: number,
  ): number {
    return Math.max(
      0,
      Math.min(1, value),
    );
  }

  private validate(
    result:
      RetrievalSourceResult,
  ): RetrievalSourceResult {
    return retrievalSourceResultSchema
      .parse(result) as
      RetrievalSourceResult;
  }
}
