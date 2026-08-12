import {
  HYBRID_RETRIEVAL_DEFAULTS,
  HYBRID_RETRIEVAL_IDS,
  HYBRID_RETRIEVAL_MESSAGES,
} from "./constants";

import {
  HybridRetrievalError,
} from "./HybridRetrievalError";

import {
  hybridRetrievalInputSchema,
  normalizedHybridRetrievalRequestSchema,
} from "./schema";

import type {
  HybridRetrievalInput,
  HybridRetrievalNormalization,
  HybridRetrievalWarning,
  NormalizedHybridRetrievalRequest,
  ResolvedHybridRetrieverOptions,
} from "./types";

export class HybridRetrievalRequestNormalizer {
  public normalize(
    input: HybridRetrievalInput,
    options:
      ResolvedHybridRetrieverOptions,
  ): HybridRetrievalNormalization {
    const parsed =
      hybridRetrievalInputSchema
        .parse(input) as
        HybridRetrievalInput;

    const warnings:
      HybridRetrievalWarning[] = [];

    const trimmedQuery =
      parsed.query.trim();

    if (!trimmedQuery) {
      return {
        warnings,
      };
    }

    const query =
      trimmedQuery.slice(
        0,
        HYBRID_RETRIEVAL_DEFAULTS
          .MAXIMUM_QUERY_CHARACTERS,
      );

    if (
      query.length <
      trimmedQuery.length
    ) {
      warnings.push({
        code:
          "query_truncated",
        message:
          HYBRID_RETRIEVAL_MESSAGES
            .QUERY_TRUNCATED,
      });
    }

    const rootIds =
      this.uniqueSorted(
        parsed.rootIds ?? [],
        warnings,
      );

    const filePaths =
      this.uniqueSorted(
        parsed.filePaths ?? [],
        warnings,
      );

    const anchorFilePaths =
      this.uniqueSorted(
        parsed.anchorFilePaths ?? [],
        warnings,
      );

    const kinds =
      this.uniqueSorted(
        parsed.kinds ?? [],
        warnings,
      );

    this.validateConsistency(
      parsed,
    );

    const request:
      NormalizedHybridRetrievalRequest = {
        workspace:
          parsed.workspace.trim(),
        query,
        rootIds,
        ...(parsed.folderPrefix
          ? {
              folderPrefix:
                parsed.folderPrefix,
            }
          : {}),
        filePaths,
        anchorFilePaths,
        kinds,
        maximumResults:
          parsed.maximumResults ??
          options.maximumResults,
        maximumCandidatesPerSource:
          parsed
            .maximumCandidatesPerSource ??
          options
            .maximumCandidatesPerSource,
        ...(parsed
          .workspaceSnapshotId
          ? {
              workspaceSnapshotId:
                parsed
                  .workspaceSnapshotId,
            }
          : {}),
        ...(parsed
          .codeIndexChangeToken
          ? {
              codeIndexChangeToken:
                parsed
                  .codeIndexChangeToken,
            }
          : {}),
        ...(parsed.repoMap
          ? {
              repoMap:
                parsed.repoMap,
            }
          : {}),
        ...(parsed.repoGraph
          ? {
              repoGraph:
                parsed.repoGraph,
            }
          : {}),
      };

    return {
      request:
        normalizedHybridRetrievalRequestSchema
          .parse(request) as
          NormalizedHybridRetrievalRequest,
      warnings,
    };
  }

  private validateConsistency(
    input: HybridRetrievalInput,
  ): void {
    const snapshotIds = [
      input.workspaceSnapshotId,
      input.repoMap
        ?.workspaceSnapshotId,
      input.repoGraph
        ?.workspaceSnapshotId,
    ].filter(
      (
        value,
      ): value is string =>
        Boolean(value),
    );

    if (
      new Set(snapshotIds).size >
      1
    ) {
      throw new HybridRetrievalError(
        HYBRID_RETRIEVAL_MESSAGES
          .SNAPSHOT_MISMATCH,
        {
          operation:
            "normalize_request",
          componentId:
            HYBRID_RETRIEVAL_IDS
              .REQUEST_NORMALIZER,
        },
      );
    }

    const changeTokens = [
      input.codeIndexChangeToken,
      input.repoMap
        ?.codeIndexChangeToken,
      input.repoGraph
        ?.codeIndexChangeToken,
    ].filter(
      (
        value,
      ): value is string =>
        Boolean(value),
    );

    if (
      new Set(changeTokens).size >
      1
    ) {
      throw new HybridRetrievalError(
        HYBRID_RETRIEVAL_MESSAGES
          .CHANGE_TOKEN_MISMATCH,
        {
          operation:
            "normalize_request",
          componentId:
            HYBRID_RETRIEVAL_IDS
              .REQUEST_NORMALIZER,
        },
      );
    }
  }

  private uniqueSorted<T extends string>(
    values: readonly T[],
    warnings:
      HybridRetrievalWarning[],
  ): T[] {
    const unique = [
      ...new Set(values),
    ];

    if (
      unique.length !==
      values.length
    ) {
      warnings.push({
        code:
          "duplicate_filter_removed",
        message:
          HYBRID_RETRIEVAL_MESSAGES
            .DUPLICATE_FILTER_REMOVED,
      });
    }

    return unique.sort(
      (left, right) =>
        left.localeCompare(right),
    );
  }
}
