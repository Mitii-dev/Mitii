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
  RepoGraphEdgeType,
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

    const queryMatches =
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
        );

    const directMatches =
      this.mergeAnchorMatches(
        this.collectFileAnchors(
          nodes,
          fileByFileId,
          request,
        ),
        queryMatches,
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

    this.expandBlastRadius({
      anchors:
        directMatches,
      edges,
      nodeById,
      fileByFileId,
      request,
      candidateByKey,
    });

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

  private collectFileAnchors(
    nodes: readonly RepoGraphNode[],
    fileByFileId: ReadonlyMap<string, RepoGraphFileNode>,
    request: NormalizedHybridRetrievalRequest,
  ): Array<{
    nodeId: string;
    candidate: RetrievalCandidate;
  }> {
    const anchors = new Set(request.anchorFilePaths ?? []);
    if (anchors.size === 0) {
      return [];
    }

    const matches: Array<{
      nodeId: string;
      candidate: RetrievalCandidate;
    }> = [];
    const anchoredFileIds = new Set<string>();

    for (const node of nodes) {
      if (node.kind !== "file" || !anchors.has(node.relativePath)) {
        continue;
      }

      const candidate = this.toCandidate(
        node,
        fileByFileId,
        HYBRID_RETRIEVAL_DEFAULTS.GRAPH_FILE_ANCHOR_SCORE,
        {
          type: "graph_file_anchor",
          evidence: `Pinned file prior for ${node.relativePath}.`,
        },
      );

      if (!candidate || !this.matchesScope(candidate, request)) {
        continue;
      }

      anchoredFileIds.add(node.fileId);
      matches.push({
        nodeId: node.id,
        candidate,
      });
    }

    for (const node of nodes) {
      if (
        node.kind !== "symbol" ||
        !anchoredFileIds.has(node.fileId)
      ) {
        continue;
      }

      const candidate = this.toCandidate(
        node,
        fileByFileId,
        HYBRID_RETRIEVAL_DEFAULTS.GRAPH_FILE_ANCHOR_SCORE,
        {
          type: "graph_file_anchor",
          evidence: `Pinned file prior for ${
            fileByFileId.get(node.fileId)?.relativePath ?? node.name
          }.`,
        },
      );

      if (!candidate || !this.matchesScope(candidate, request)) {
        continue;
      }

      matches.push({
        nodeId: node.id,
        candidate,
      });
    }

    return matches.sort(
      (left, right) =>
        left.nodeId.localeCompare(right.nodeId),
    );
  }

  private mergeAnchorMatches(
    fileAnchors: readonly {
      nodeId: string;
      candidate: RetrievalCandidate;
    }[],
    queryMatches: readonly {
      nodeId: string;
      candidate: RetrievalCandidate;
    }[],
  ): Array<{
    nodeId: string;
    candidate: RetrievalCandidate;
  }> {
    const reserved = fileAnchors.slice(
      0,
      this.options.maximumAnchorNodes,
    );
    const reservedIds = new Set(
      reserved.map((match) => match.nodeId),
    );
    const remaining =
      this.options.maximumAnchorNodes - reserved.length;
    const queryFill = queryMatches
      .filter((match) => !reservedIds.has(match.nodeId))
      .slice(0, remaining);
    return [...reserved, ...queryFill];
  }

  private expandBlastRadius(input: {
    anchors: readonly {
      nodeId: string;
      candidate:
        RetrievalCandidate;
    }[];
    edges: readonly RepoGraphEdge[];
    nodeById:
      ReadonlyMap<
        string,
        RepoGraphNode
      >;
    fileByFileId:
      ReadonlyMap<
        string,
        RepoGraphFileNode
      >;
    request:
      NormalizedHybridRetrievalRequest;
    candidateByKey:
      Map<
        string,
        RetrievalCandidate
      >;
  }): void {
    const adjacency =
      this.createRetrievalAdjacency(
        input.edges,
        input.nodeById,
      );

    for (const anchor of input.anchors) {
      let acceptedNeighbors = 0;
      const visited =
        new Set([
          anchor.nodeId,
        ]);
      const queue: {
        nodeId: string;
        depth: number;
      }[] = [
        {
          nodeId:
            anchor.nodeId,
          depth: 0,
        },
      ];

      while (queue.length > 0) {
        const current =
          queue.shift();

        if (!current) {
          break;
        }

        if (
          current.depth >=
          this.options.maximumHops
        ) {
          continue;
        }

        const neighbors =
          adjacency.get(
            current.nodeId,
          ) ?? [];

        for (const neighbor of neighbors) {
          if (
            visited.has(
              neighbor.nodeId,
            )
          ) {
            continue;
          }

          visited.add(
            neighbor.nodeId,
          );

          const nextDepth =
            current.depth + 1;
          queue.push({
            nodeId:
              neighbor.nodeId,
            depth:
              nextDepth,
          });

          if (
            acceptedNeighbors >=
            this.options
              .maximumNeighborsPerAnchor
          ) {
            continue;
          }

          const node =
            input.nodeById.get(
              neighbor.nodeId,
            );

          if (!node) {
            continue;
          }

          const candidate =
            this.toCandidate(
              node,
              input.fileByFileId,
              this.neighborScore(
                anchor.candidate
                  .sourceScore,
                nextDepth,
              ),
              this.graphNeighborReason(
                neighbor.edge,
                nextDepth,
              ),
            );

          if (
            !candidate ||
            !this.matchesScope(
              candidate,
              input.request,
            )
          ) {
            continue;
          }

          acceptedNeighbors += 1;

          this.addCandidate(
            input.candidateByKey,
            candidate,
          );
        }
      }
    }
  }

  private createRetrievalAdjacency(
    edges: readonly RepoGraphEdge[],
    nodeById:
      ReadonlyMap<
        string,
        RepoGraphNode
      >,
  ): ReadonlyMap<
    string,
    readonly {
      nodeId: string;
      edge: RepoGraphEdge;
    }[]
  > {
    const adjacency =
      new Map<
        string,
        {
          nodeId: string;
          edge: RepoGraphEdge;
        }[]
      >();

    for (const edge of edges) {
      if (
        !this.isRetrievalEdge(
          edge,
        ) ||
        !nodeById.has(
          edge.fromNodeId,
        ) ||
        !nodeById.has(edge.toNodeId)
      ) {
        continue;
      }

      this.addAdjacentEdge(
        adjacency,
        edge.fromNodeId,
        edge.toNodeId,
        edge,
      );
      this.addAdjacentEdge(
        adjacency,
        edge.toNodeId,
        edge.fromNodeId,
        edge,
      );
    }

    for (
      const neighbors of
      adjacency.values()
    ) {
      neighbors.sort(
        (left, right) =>
          this.edgeTypeOrder(
            left.edge.type,
          ) -
            this.edgeTypeOrder(
              right.edge.type,
            ) ||
          left.nodeId.localeCompare(
            right.nodeId,
          ) ||
          left.edge.id.localeCompare(
            right.edge.id,
          ),
      );
    }

    return adjacency;
  }

  private addAdjacentEdge(
    adjacency:
      Map<
        string,
        {
          nodeId: string;
          edge: RepoGraphEdge;
        }[]
      >,
    fromNodeId: string,
    toNodeId: string,
    edge: RepoGraphEdge,
  ): void {
    const neighbors =
      adjacency.get(fromNodeId) ?? [];

    neighbors.push({
      nodeId:
        toNodeId,
      edge,
    });

    adjacency.set(
      fromNodeId,
      neighbors,
    );
  }

  private graphNeighborReason(
    edge: RepoGraphEdge,
    hop: number,
  ): RetrievalReason {
    return {
      type:
        this.graphNeighborReasonType(
          edge.type,
        ),
      evidence:
        `${edge.type} relationship from graph edge ${edge.id} at hop ${hop}.`,
    };
  }

  private graphNeighborReasonType(
    edgeType:
      RepoGraphEdgeType,
  ): RetrievalReason["type"] {
    if (edgeType === "calls") {
      return "graph_call_neighbor";
    }

    if (edgeType === "imports") {
      return "graph_import_neighbor";
    }

    return "graph_reference_neighbor";
  }

  private neighborScore(
    anchorScore: number,
    hop: number,
  ): number {
    return Math.max(
      HYBRID_RETRIEVAL_DEFAULTS
        .GRAPH_MINIMUM_NEIGHBOR_SCORE,
      anchorScore *
        HYBRID_RETRIEVAL_DEFAULTS
          .GRAPH_NEIGHBOR_SCORE_FACTOR **
          hop,
    );
  }

  private edgeTypeOrder(
    edgeType:
      RepoGraphEdgeType,
  ): number {
    const index =
      this.options.edgeTypes
        .indexOf(edgeType);

    return index >= 0
      ? index
      : Number.MAX_SAFE_INTEGER;
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

    if (!this.matchesFileScope(candidate.relativePath, request)) {
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

  private isRetrievalEdge(
    edge: RepoGraphEdge,
  ): boolean {
    return this.options.edgeTypes
      .includes(edge.type);
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
    this.validatePositiveInteger(
      this.options.maximumHops,
      HYBRID_RETRIEVAL_LIMITS
        .MAXIMUM_GRAPH_HOPS,
      "maximumHops",
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
