import {
  HYBRID_RETRIEVAL_DEFAULTS,
  HYBRID_RETRIEVAL_MESSAGES,
} from "./constants";

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

    const scopedFilters =
      this.promoteDirectoryLikeFilePaths(
        filePaths,
        parsed.folderPrefix,
      );

    const intelligence =
      this.reconcileRepositoryIntelligence(
        parsed,
        warnings,
      );

    const request:
      NormalizedHybridRetrievalRequest = {
        workspace:
          parsed.workspace.trim(),
        query,
        rootIds,
        ...(scopedFilters.folderPrefix
          ? {
              folderPrefix:
                scopedFilters.folderPrefix,
            }
          : {}),
        filePaths:
          scopedFilters.filePaths,
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
        ...(intelligence
          .codeIndexChangeToken
          ? {
              codeIndexChangeToken:
                intelligence
                  .codeIndexChangeToken,
            }
          : {}),
        ...(intelligence.repoMap
          ? {
              repoMap:
                intelligence.repoMap,
            }
          : {}),
        ...(intelligence.repoGraph
          ? {
              repoGraph:
                intelligence.repoGraph,
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

  /**
   * Directory-like `filePaths` (for example `@packages/demo` misclassified as a
   * file) would otherwise require an exact indexed path match and zero every
   * source. Promote them to `folderPrefix` so lexical/map/graph retrieval can
   * search inside the mentioned folder.
   */
  private promoteDirectoryLikeFilePaths(
    filePaths: readonly string[],
    folderPrefix: string | undefined,
  ): {
    filePaths: string[];
    folderPrefix?: string;
  } {
    const files: string[] = [];
    const folders: string[] = [];

    for (const path of filePaths) {
      if (this.looksLikeFilePath(path)) {
        files.push(path);
      } else {
        folders.push(path);
      }
    }

    if (folderPrefix) {
      folders.push(folderPrefix);
    }

    const preferredFolder = [...new Set(folders)].sort(
      (left, right) =>
        right.length - left.length ||
        left.localeCompare(right),
    )[0];

    return {
      filePaths: files,
      ...(preferredFolder
        ? {
            folderPrefix: preferredFolder,
          }
        : {}),
    };
  }

  private looksLikeFilePath(
    path: string,
  ): boolean {
    const lastSegment =
      path.split("/").at(-1) ?? "";
    if (!lastSegment) {
      return false;
    }
    if (
      lastSegment.startsWith(".") &&
      lastSegment.length > 1
    ) {
      return true;
    }
    return (
      lastSegment.includes(".") &&
      !lastSegment.endsWith(".")
    );
  }

  /**
   * Stale Repo Map / Repo Graph must not abort lexical or vector retrieval.
   * Drop the mismatched intelligence and continue with remaining sources.
   */
  private reconcileRepositoryIntelligence(
    input: HybridRetrievalInput,
    warnings: HybridRetrievalWarning[],
  ): {
    repoMap?: HybridRetrievalInput["repoMap"];
    repoGraph?: HybridRetrievalInput["repoGraph"];
    codeIndexChangeToken?: string;
  } {
    let repoMap = input.repoMap;
    let repoGraph = input.repoGraph;
    const pinnedSnapshot =
      input.workspaceSnapshotId?.trim() ||
      undefined;

    const dropMap = () => {
      if (!repoMap) {
        return;
      }
      repoMap = undefined;
      warnings.push({
        code: "optional_source_unavailable",
        message:
          HYBRID_RETRIEVAL_MESSAGES
            .SNAPSHOT_MISMATCH,
      });
    };
    const dropGraph = () => {
      if (!repoGraph) {
        return;
      }
      repoGraph = undefined;
      warnings.push({
        code: "optional_source_unavailable",
        message:
          HYBRID_RETRIEVAL_MESSAGES
            .SNAPSHOT_MISMATCH,
      });
    };
    const dropForChangeToken = () => {
      warnings.push({
        code: "optional_source_unavailable",
        message:
          HYBRID_RETRIEVAL_MESSAGES
            .CHANGE_TOKEN_MISMATCH,
      });
    };

    if (pinnedSnapshot) {
      if (
        repoMap &&
        repoMap.workspaceSnapshotId !==
          pinnedSnapshot
      ) {
        dropMap();
      }
      if (
        repoGraph &&
        repoGraph.workspaceSnapshotId !==
          pinnedSnapshot
      ) {
        dropGraph();
      }
    } else {
      const snapshotIds = [
        repoMap?.workspaceSnapshotId,
        repoGraph?.workspaceSnapshotId,
      ].filter(
        (value): value is string =>
          Boolean(value),
      );
      if (new Set(snapshotIds).size > 1) {
        dropMap();
        dropGraph();
      }
    }

    const pinnedToken =
      input.codeIndexChangeToken?.trim() ||
      undefined;
    if (pinnedToken) {
      if (
        repoMap &&
        repoMap.codeIndexChangeToken !==
          pinnedToken
      ) {
        repoMap = undefined;
        dropForChangeToken();
      }
      if (
        repoGraph &&
        repoGraph.codeIndexChangeToken !==
          pinnedToken
      ) {
        repoGraph = undefined;
        dropForChangeToken();
      }
    } else if (
      repoMap &&
      repoGraph &&
      repoMap.codeIndexChangeToken !==
        repoGraph.codeIndexChangeToken
    ) {
      repoMap = undefined;
      repoGraph = undefined;
      dropForChangeToken();
    }

    const remainingTokens = [
      repoMap?.codeIndexChangeToken,
      repoGraph?.codeIndexChangeToken,
    ].filter(
      (value): value is string =>
        Boolean(value),
    );
    const codeIndexChangeToken =
      remainingTokens.length > 0
        ? remainingTokens[0]
        : undefined;

    return {
      ...(repoMap ? { repoMap } : {}),
      ...(repoGraph ? { repoGraph } : {}),
      ...(codeIndexChangeToken
        ? {
            codeIndexChangeToken,
          }
        : {}),
    };
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
