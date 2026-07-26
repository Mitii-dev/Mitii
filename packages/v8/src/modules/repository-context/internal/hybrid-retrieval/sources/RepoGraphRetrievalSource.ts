import {
  HYBRID_RETRIEVAL_DEFAULTS,
  HYBRID_RETRIEVAL_GRAPH_EDGE_TYPES,
  HYBRID_RETRIEVAL_IDS,
  HYBRID_RETRIEVAL_LIMITS,
} from "../constants";

import {
  RetrievalCandidateKeyBuilder,
} from "../RetrievalCandidateKeyBuilder";

import {
  retrievalSourceResultSchema,
} from "../schema";

import {
  CodeQueryTokenizer,
} from "./CodeQueryTokenizer";

import type {
  RepoGraphEdge,
  RepoGraphFileNode,
  RepoGraphNode,
  RepoGraphSymbolNode,
} from "../../../../repository-state/index";

import type {
  NormalizedHybridRetrievalRequest,
  RepoGraphRetrievalSourceOptions,
  ResolvedRepoGraphRetrievalSourceOptions,
  RetrievalCandidate,
  RetrievalReason,
  RetrievalSource,
  RetrievalSourceResult,
} from "../types";

export class RepoGraphRetrievalSource
  implements RetrievalSource
{
  public readonly id =
    HYBRID_RETRIEVAL_IDS
      .REPO_GRAPH_SOURCE;

  private readonly options:
    ResolvedRepoGraphRetrievalSourceOptions;

  constructor(
    options:
      RepoGraphRetrievalSourceOptions = {},
    private readonly tokenizer =
      new CodeQueryTokenizer(),
    private readonly keyBuilder =
      new RetrievalCandidateKeyBuilder(),
  ) {
    this.options = {
      maximumNodesScanned:
        options.maximumNodesScanned ??
        HYBRID_RETRIEVAL_DEFAULTS
          .GRAPH_MAXIMUM_NODES_SCANNED,
      maximumEdgesScanned:
        options.maximumEdgesScanned ??
        HYBRID_RETRIEVAL_DEFAULTS
          .GRAPH_MAXIMUM_EDGES_SCANNED,
      maximumAnchorNodes:
        options.maximumAnchorNodes ??
        HYBRID_RETRIEVAL_DEFAULTS
          .GRAPH_MAXIMUM_ANCHOR_NODES,
      maximumNeighborsPerAnchor:
        options
          .maximumNeighborsPerAnchor ??
        HYBRID_RETRIEVAL_DEFAULTS
          .GRAPH_MAXIMUM_NEIGHBORS_PER_ANCHOR,
    };

    this.validateOptions();
  }

  public canRetrieve(
    request:
      NormalizedHybridRetrievalRequest,
  ): boolean {
    return (
      request.repoGraph !==
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
    const graph =
      request.repoGraph;

    if (!graph) {
      return this.validate({
        status:
          "unavailable",
        candidates: [],
        truncated:
          false,
        warnings: [],
      });
    }

    const nodes =
      graph.nodes.slice(
        0,
        this.options
          .maximumNodesScanned,
      );
    const edges =
      graph.edges.slice(
        0,
        this.options
          .maximumEdgesScanned,
      );

    const nodesTruncated =
      graph.nodes.length >
      nodes.length;
    const edgesTruncated =
      graph.edges.length >
      edges.length;

    const nodeById =
      new Map(
        nodes.map(
          (node) => [
            node.id,
            node,
          ],
        ),
      );

    const fileByFileId =
      new Map(
        nodes
          .filter(
            (
              node,
            ): node is
              RepoGraphFileNode =>
              node.kind ===
              "file",
          )
          .map(
            (node) => [
              node.fileId,
              node,
            ],
          ),
      );

    const tokens =
      this.tokenizer
        .tokenize(
          request.query,
        );
    const queryLower =
      request.query
        .toLowerCase();

    const directMatches =
      nodes.flatMap(
        (node) => {
          const score =
            this.directScore(
              node,
              queryLower,
              tokens,
            );

          if (score <= 0) {
            return [];
          }

          const candidate =
            this.toCandidate(
              node,
              fileByFileId,
              score,
              this.directReason(
                node,
              ),
            );

          if (
            !candidate ||
            !this.matchesScope(
              candidate,
              request,
            )
          ) {
            return [];
          }

          return [
            {
              nodeId:
                node.id,
              candidate,
            },
          ];
        },
      )
        .sort(
          (left, right) =>
            right.candidate
              .sourceScore -
              left.candidate
                .sourceScore ||
            left.nodeId
              .localeCompare(
                right.nodeId,
              ),
        )
        .slice(
          0,
          this.options
            .maximumAnchorNodes,
        );

    const candidateByKey =
      new Map<
        string,
        RetrievalCandidate
      >();

    for (
      const match of
        directMatches
    ) {
      this.addCandidate(
        candidateByKey,
        match.candidate,
      );
    }

    const anchorScoreByNodeId =
      new Map(
        directMatches.map(
          (match) => [
            match.nodeId,
            match.candidate
              .sourceScore,
          ],
        ),
      );

    const neighborCounts =
      new Map<string, number>();

    for (const edge of edges) {
      if (
        !this.isRetrievalEdge(
          edge,
        )
      ) {
        continue;
      }

      const fromScore =
        anchorScoreByNodeId.get(
          edge.fromNodeId,
        );
      const toScore =
        anchorScoreByNodeId.get(
          edge.toNodeId,
        );

      if (
        fromScore ===
          undefined &&
        toScore ===
          undefined
      ) {
        continue;
      }

      const anchorNodeId =
        fromScore !== undefined
          ? edge.fromNodeId
          : edge.toNodeId;
      const neighborNodeId =
        fromScore !== undefined
          ? edge.toNodeId
          : edge.fromNodeId;
      const anchorScore =
        fromScore ??
        toScore ??
        0;

      const currentCount =
        neighborCounts.get(
          anchorNodeId,
        ) ?? 0;

      if (
        currentCount >=
        this.options
          .maximumNeighborsPerAnchor
      ) {
        continue;
      }

      const neighborNode =
        nodeById.get(
          neighborNodeId,
        );

      if (!neighborNode) {
        continue;
      }

      const candidate =
        this.toCandidate(
          neighborNode,
          fileByFileId,
          Math.max(
            HYBRID_RETRIEVAL_DEFAULTS
              .GRAPH_MINIMUM_NEIGHBOR_SCORE,
            anchorScore *
              HYBRID_RETRIEVAL_DEFAULTS
                .GRAPH_NEIGHBOR_SCORE_FACTOR,
          ),
          {
            type:
              edge.type ===
                "imports"
                ? "graph_import_neighbor"
                : "graph_reference_neighbor",
            evidence:
              `${edge.type} relationship from graph edge ${edge.id}.`,
          },
        );

      if (
        !candidate ||
        !this.matchesScope(
          candidate,
          request,
        )
      ) {
        continue;
      }

      neighborCounts.set(
        anchorNodeId,
        currentCount + 1,
      );

      this.addCandidate(
        candidateByKey,
        candidate,
      );
    }

    const candidates = [
      ...candidateByKey
        .values(),
    ].sort(
      (left, right) =>
        right.sourceScore -
          left.sourceScore ||
        left.relativePath
          .localeCompare(
            right.relativePath,
          ) ||
        (
          left.symbolId ?? ""
        ).localeCompare(
          right.symbolId ?? "",
        ),
    );

    const candidateTruncated =
      candidates.length >
      request
        .maximumCandidatesPerSource;
    const truncated =
      nodesTruncated ||
      edgesTruncated ||
      candidateTruncated;

    const warnings:
      RetrievalSourceResult[
        "warnings"
      ] = [];

    if (nodesTruncated) {
      warnings.push({
        code:
          "graph_node_scan_limit_reached",
        message:
          "Repo Graph node scan reached its configured safety limit.",
      });
    }

    if (edgesTruncated) {
      warnings.push({
        code:
          "graph_edge_scan_limit_reached",
        message:
          "Repo Graph edge scan reached its configured safety limit.",
      });
    }

    if (candidateTruncated) {
      warnings.push({
        code:
          "source_limit_reached",
        message:
          "Repo Graph candidates exceeded the per-source limit.",
      });
    }

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
      warnings,
    });
  }

  private directScore(
    node: RepoGraphNode,
    queryLower: string,
    tokens: readonly string[],
  ): number {
    if (
      node.kind ===
      "project"
    ) {
      return 0;
    }

    if (
      node.kind ===
      "symbol"
    ) {
      const name =
        node.name
          .toLowerCase();

      if (
        tokens.includes(name)
      ) {
        return HYBRID_RETRIEVAL_DEFAULTS
          .GRAPH_EXACT_SYMBOL_SCORE;
      }

      if (
        name.length >=
          HYBRID_RETRIEVAL_DEFAULTS
            .MINIMUM_QUERY_TOKEN_CHARACTERS &&
        queryLower.includes(name)
      ) {
        return HYBRID_RETRIEVAL_DEFAULTS
          .GRAPH_SYMBOL_SUBSTRING_SCORE;
      }

      return 0;
    }

    const relativePath =
      node.relativePath
        .toLowerCase();

    if (
      queryLower.includes(
        relativePath,
      )
    ) {
      return HYBRID_RETRIEVAL_DEFAULTS
        .GRAPH_EXACT_PATH_SCORE;
    }

    const baseName =
      relativePath
        .split("/")
        .at(-1) ??
      relativePath;
    const extensionIndex =
      baseName
        .lastIndexOf(".");
    const extension =
      extensionIndex > 0
        ? baseName.slice(
            extensionIndex,
          )
        : "";
    const stem =
      baseName.slice(
        0,
        baseName.length -
          extension.length,
      );

    if (
      tokens.includes(
        baseName,
      ) ||
      tokens.includes(stem)
    ) {
      return HYBRID_RETRIEVAL_DEFAULTS
        .GRAPH_FILE_NAME_SCORE;
    }

    if (
      tokens.some(
        (token) =>
          relativePath.includes(
            token,
          ),
      )
    ) {
      return HYBRID_RETRIEVAL_DEFAULTS
        .GRAPH_PATH_TOKEN_SCORE;
    }

    return 0;
  }

  private directReason(
    node: RepoGraphNode,
  ): RetrievalReason {
    if (
      node.kind ===
      "symbol"
    ) {
      return {
        type:
          "graph_symbol_match",
        evidence:
          `Graph symbol match for ${node.name}.`,
      };
    }

    if (
      node.kind ===
      "project"
    ) {
      return {
        type:
          "graph_path_match",
        evidence:
          `Graph project match for ${node.name}.`,
      };
    }

    return {
      type:
        "graph_path_match",
      evidence:
        `Graph path match for ${node.relativePath}.`,
    };
  }

  private toCandidate(
    node: RepoGraphNode,
    fileByFileId:
      ReadonlyMap<
        string,
        RepoGraphFileNode
      >,
    score: number,
    reason: RetrievalReason,
  ): RetrievalCandidate | null {
    if (
      node.kind ===
      "project"
    ) {
      return null;
    }

    if (
      node.kind ===
      "file"
    ) {
      return {
        entityKind:
          "file",
        rootId:
          node.rootId,
        relativePath:
          node.relativePath,
        ...(node.contentHash
          ? {
              contentHash:
                node.contentHash,
            }
          : {}),
        sourceScore:
          this.clamp(score),
        reasons: [
          reason,
        ],
      };
    }

    return this.toSymbolCandidate(
      node,
      fileByFileId,
      score,
      reason,
    );
  }

  private toSymbolCandidate(
    node: RepoGraphSymbolNode,
    fileByFileId:
      ReadonlyMap<
        string,
        RepoGraphFileNode
      >,
    score: number,
    reason: RetrievalReason,
  ): RetrievalCandidate | null {
    const file =
      fileByFileId.get(
        node.fileId,
      );

    if (!file) {
      return null;
    }

    return {
      entityKind:
        "symbol",
      rootId:
        file.rootId,
      relativePath:
        file.relativePath,
      symbolId:
        node.symbolId,
      ...(node.startLine !==
      undefined
        ? {
            startLine:
              node.startLine,
          }
        : {}),
      ...(node.endLine !==
      undefined
        ? {
            endLine:
              node.endLine,
          }
        : {}),
      title:
        node.name,
      ...(file.contentHash
        ? {
            contentHash:
              file.contentHash,
          }
        : {}),
      sourceScore:
        this.clamp(score),
      reasons: [
        reason,
      ],
    };
  }

  private addCandidate(
    candidates:
      Map<
        string,
        RetrievalCandidate
      >,
    candidate:
      RetrievalCandidate,
  ): void {
    const key =
      this.keyBuilder
        .build(candidate);
    const existing =
      candidates.get(key);

    if (!existing) {
      candidates.set(
        key,
        candidate,
      );
      return;
    }

    const reasons =
      new Map(
        [
          ...existing.reasons,
          ...candidate.reasons,
        ].map(
          (reason) => [
            `${reason.type}\u0000${reason.evidence}`,
            reason,
          ],
        ),
      );

    candidates.set(
      key,
      {
        ...(
          candidate.sourceScore >
          existing.sourceScore
            ? candidate
            : existing
        ),
        sourceScore:
          Math.max(
            candidate.sourceScore,
            existing.sourceScore,
          ),
        reasons: [
          ...reasons.values(),
        ],
      },
    );
  }

  private matchesScope(
    candidate:
      RetrievalCandidate,
    request:
      NormalizedHybridRetrievalRequest,
  ): boolean {
    if (
      request.rootIds.length >
        0 &&
      !request.rootIds.includes(
        candidate.rootId,
      )
    ) {
      return false;
    }

    if (
      request.filePaths.length >
        0 &&
      !request.filePaths.includes(
        candidate.relativePath,
      )
    ) {
      return false;
    }

    if (
      request.folderPrefix &&
      candidate.relativePath !==
        request.folderPrefix &&
      !candidate.relativePath
        .startsWith(
          `${request.folderPrefix}/`,
        )
    ) {
      return false;
    }

    return true;
  }

  private isRetrievalEdge(
    edge: RepoGraphEdge,
  ): boolean {
    return (
      HYBRID_RETRIEVAL_GRAPH_EDGE_TYPES as
        readonly string[]
    ).includes(edge.type);
  }

  private validateOptions(): void {
    this.validatePositiveInteger(
      this.options
        .maximumNodesScanned,
      HYBRID_RETRIEVAL_LIMITS
        .MAXIMUM_GRAPH_NODES_SCANNED,
      "maximumNodesScanned",
    );
    this.validatePositiveInteger(
      this.options
        .maximumEdgesScanned,
      HYBRID_RETRIEVAL_LIMITS
        .MAXIMUM_GRAPH_EDGES_SCANNED,
      "maximumEdgesScanned",
    );
    this.validatePositiveInteger(
      this.options
        .maximumAnchorNodes,
      HYBRID_RETRIEVAL_LIMITS
        .MAXIMUM_GRAPH_ANCHORS,
      "maximumAnchorNodes",
    );
    this.validatePositiveInteger(
      this.options
        .maximumNeighborsPerAnchor,
      HYBRID_RETRIEVAL_LIMITS
        .MAXIMUM_GRAPH_NEIGHBORS_PER_ANCHOR,
      "maximumNeighborsPerAnchor",
    );
  }

  private validatePositiveInteger(
    value: number,
    maximum: number,
    name: string,
  ): void {
    if (
      !Number.isSafeInteger(
        value,
      ) ||
      value <= 0 ||
      value > maximum
    ) {
      throw new RangeError(
        `${name} must be a positive safe integer no greater than ${maximum}.`,
      );
    }
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
