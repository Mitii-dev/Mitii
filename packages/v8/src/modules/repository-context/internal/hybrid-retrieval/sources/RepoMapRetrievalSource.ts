import {
  HYBRID_RETRIEVAL_DEFAULTS,
  HYBRID_RETRIEVAL_IDS,
} from "../constants";

import {
  retrievalSourceResultSchema,
} from "../schema";

import type {
  RepoMapEntry,
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

  public canRetrieve(
    request:
      NormalizedHybridRetrievalRequest,
  ): boolean {
    return (
      request.repoMap !==
        undefined &&
      (
        request.kinds.length ===
          0 ||
        request.kinds.includes(
          "code_symbol",
        ) ||
        request.kinds.includes(
          "code_region",
        )
      )
    );
  }

  public async retrieve(
    request:
      NormalizedHybridRetrievalRequest,
  ): Promise<RetrievalSourceResult> {
    const repoMap =
      request.repoMap;

    if (!repoMap) {
      return this.validate({
        status:
          "unavailable",
        candidates: [],
        truncated:
          false,
        warnings: [],
      });
    }

    const matching =
      repoMap.entries.filter(
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

    if (
      request.filePaths.length >
        0 &&
      !request.filePaths.includes(
        entry.file.relativePath,
      )
    ) {
      return false;
    }

    if (
      request.folderPrefix &&
      entry.file.relativePath !==
        request.folderPrefix &&
      !entry.file.relativePath
        .startsWith(
          `${request.folderPrefix}/`,
        )
    ) {
      return false;
    }

    return true;
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
