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

import {
  collectFileAnchors,
  mergeAnchorMatches,
} from "./RepoGraphAnchors";

import {
  expandBlastRadius,
} from "./RepoGraphBlastRadius";

import {
  addGraphCandidate,
  candidateMatchesScope,
  toGraphCandidate,
} from "./RepoGraphCandidates";

import {
  describeDirectMatch,
  scoreGraphNode,
} from "./RepoGraphScoring";

import type {
  RepoGraphAnchorMatch,
} from "./RepoGraphCandidates";

import type {
  RepoGraphFileNode,
} from "../../../../repository-state/index";

import type {
  NormalizedHybridRetrievalRequest,
  RepoGraphRetrievalSourceOptions,
  ResolvedRepoGraphRetrievalSourceOptions,
  RetrievalCandidate,
  RetrievalSource,
  RetrievalSourceResult,
} from "../types";

export class RepoGraphRetrievalSource
  implements RetrievalSource
{
  public readonly id =
    HYBRID_RETRIEVAL_IDS.REPO_GRAPH_SOURCE;

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
        options.maximumNeighborsPerAnchor ??
        HYBRID_RETRIEVAL_DEFAULTS
          .GRAPH_MAXIMUM_NEIGHBORS_PER_ANCHOR,
      maximumHops:
        options.maximumHops ??
        HYBRID_RETRIEVAL_DEFAULTS
          .GRAPH_MAXIMUM_HOPS,
      edgeTypes:
        options.edgeTypes ??
        HYBRID_RETRIEVAL_GRAPH_EDGE_TYPES,
    };

    this.validateOptions();
  }

  public canRetrieve(
    request: NormalizedHybridRetrievalRequest,
  ): boolean {
    return (
      request.repoGraph !== undefined &&
      (request.kinds.length === 0 ||
        request.kinds.includes("code_symbol") ||
        request.kinds.includes("code_region"))
    );
  }

  public async retrieve(
    request: NormalizedHybridRetrievalRequest,
  ): Promise<RetrievalSourceResult> {
    const graph = request.repoGraph;

    if (!graph) {
      return this.validate({
        status: "unavailable",
        candidates: [],
        truncated: false,
        warnings: [],
      });
    }

    const nodes = graph.nodes.slice(
      0,
      this.options.maximumNodesScanned,
    );
    const edges = graph.edges.slice(
      0,
      this.options.maximumEdgesScanned,
    );
    const nodesTruncated =
      graph.nodes.length > nodes.length;
    const edgesTruncated =
      graph.edges.length > edges.length;

    const nodeById = new Map(
      nodes.map((node) => [node.id, node]),
    );
    const fileByFileId = new Map(
      nodes
        .filter(
          (node): node is RepoGraphFileNode =>
            node.kind === "file",
        )
        .map((node) => [node.fileId, node]),
    );

    const tokens = this.tokenizer.tokenize(
      request.query,
    );
    const queryLower = request.query.toLowerCase();

    const queryMatches: RepoGraphAnchorMatch[] =
      nodes
        .flatMap((node) => {
          const score = scoreGraphNode(
            node,
            queryLower,
            tokens,
          );

          if (score <= 0) {
            return [];
          }

          const candidate = toGraphCandidate(
            node,
            fileByFileId,
            score,
            describeDirectMatch(node),
          );

          if (
            !candidate ||
            !candidateMatchesScope(
              candidate,
              request,
            )
          ) {
            return [];
          }

          return [{ nodeId: node.id, candidate }];
        })
        .sort(
          (left, right) =>
            right.candidate.sourceScore -
              left.candidate.sourceScore ||
            left.nodeId.localeCompare(
              right.nodeId,
            ),
        );

    const directMatches = mergeAnchorMatches(
      collectFileAnchors(
        nodes,
        fileByFileId,
        request,
      ),
      queryMatches,
      this.options.maximumAnchorNodes,
    );

    const candidateByKey = new Map<
      string,
      RetrievalCandidate
    >();

    for (const match of directMatches) {
      addGraphCandidate(
        candidateByKey,
        match.candidate,
        this.keyBuilder,
      );
    }

    expandBlastRadius({
      anchors: directMatches,
      edges,
      nodeById,
      fileByFileId,
      request,
      candidateByKey,
      edgeTypes: this.options.edgeTypes,
      maximumHops: this.options.maximumHops,
      maximumNeighborsPerAnchor:
        this.options.maximumNeighborsPerAnchor,
      keyBuilder: this.keyBuilder,
    });

    const candidates = [
      ...candidateByKey.values(),
    ].sort(
      (left, right) =>
        right.sourceScore - left.sourceScore ||
        left.relativePath.localeCompare(
          right.relativePath,
        ) ||
        (left.symbolId ?? "").localeCompare(
          right.symbolId ?? "",
        ),
    );

    const candidateTruncated =
      candidates.length >
      request.maximumCandidatesPerSource;
    const truncated =
      nodesTruncated ||
      edgesTruncated ||
      candidateTruncated;

    const warnings: RetrievalSourceResult["warnings"] =
      [];

    if (nodesTruncated) {
      warnings.push({
        code: "graph_node_scan_limit_reached",
        message:
          "Repo Graph node scan reached its configured safety limit.",
      });
    }

    if (edgesTruncated) {
      warnings.push({
        code: "graph_edge_scan_limit_reached",
        message:
          "Repo Graph edge scan reached its configured safety limit.",
      });
    }

    if (candidateTruncated) {
      warnings.push({
        code: "source_limit_reached",
        message:
          "Repo Graph candidates exceeded the per-source limit.",
      });
    }

    return this.validate({
      status:
        candidates.length > 0
          ? "complete"
          : "empty",
      candidates: candidates.slice(
        0,
        request.maximumCandidatesPerSource,
      ),
      truncated,
      warnings,
    });
  }

  private validateOptions(): void {
    this.validatePositiveInteger(
      this.options.maximumNodesScanned,
      HYBRID_RETRIEVAL_LIMITS
        .MAXIMUM_GRAPH_NODES_SCANNED,
      "maximumNodesScanned",
    );
    this.validatePositiveInteger(
      this.options.maximumEdgesScanned,
      HYBRID_RETRIEVAL_LIMITS
        .MAXIMUM_GRAPH_EDGES_SCANNED,
      "maximumEdgesScanned",
    );
    this.validatePositiveInteger(
      this.options.maximumAnchorNodes,
      HYBRID_RETRIEVAL_LIMITS
        .MAXIMUM_GRAPH_ANCHORS,
      "maximumAnchorNodes",
    );
    this.validatePositiveInteger(
      this.options.maximumNeighborsPerAnchor,
      HYBRID_RETRIEVAL_LIMITS
        .MAXIMUM_GRAPH_NEIGHBORS_PER_ANCHOR,
      "maximumNeighborsPerAnchor",
    );
    this.validatePositiveInteger(
      this.options.maximumHops,
      HYBRID_RETRIEVAL_LIMITS.MAXIMUM_GRAPH_HOPS,
      "maximumHops",
    );
  }

  private validatePositiveInteger(
    value: number,
    maximum: number,
    name: string,
  ): void {
    if (
      !Number.isSafeInteger(value) ||
      value <= 0 ||
      value > maximum
    ) {
      throw new RangeError(
        `${name} must be a positive safe integer no greater than ${maximum}.`,
      );
    }
  }

  private validate(
    result: RetrievalSourceResult,
  ): RetrievalSourceResult {
    return retrievalSourceResultSchema.parse(
      result,
    ) as RetrievalSourceResult;
  }
}
