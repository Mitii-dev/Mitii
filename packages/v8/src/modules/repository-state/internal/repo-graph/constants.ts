import type {
  RepoGraphBuilderOptions,
  RepoGraphEdgeType,
  RepoGraphNodeKind,
} from "./types";

export const REPO_GRAPH_SCHEMA_VERSION =
  1 as const;

export const REPO_GRAPH_DEFAULTS = {
  MAXIMUM_FILES: 20_000,
  MAXIMUM_SYMBOLS_PER_FILE: 200,
  MAXIMUM_SYMBOL_NODES: 150_000,
  MAXIMUM_NODES: 175_000,
  MAXIMUM_EDGES: 250_000,
  MAXIMUM_EVIDENCE_PER_EDGE: 5,
  SYMBOL_BATCH_SIZE: 250,
  GRAPH_BATCH_SIZE: 500,
  MAXIMUM_CONSISTENCY_RETRIES: 1,
} as const;

export const REPO_GRAPH_NODE_PREFIXES = {
  PROJECT: "project",
} as const;

export const REPO_GRAPH_EDGE_PREFIX =
  "edge";

export const REPO_GRAPH_NODE_ORDER: Readonly<
  Record<RepoGraphNodeKind, number>
> = {
  project: 10,
  file: 20,
  symbol: 30,
};

export const REPO_GRAPH_EDGE_ORDER: Readonly<
  Record<RepoGraphEdgeType, number>
> = {
  imports: 10,
  references: 20,
  depends_on: 30,
  development_depends_on: 40,
  workspace_member: 50,
  declares: 60,
  contains: 70,
};

/**
 * Builder processes edge categories in this priority order before
 * applying the hard maximumEdges limit.
 */
export const REPO_GRAPH_EDGE_BUDGET_PRIORITY: Readonly<
  Record<RepoGraphEdgeType, number>
> = {
  imports: 100,
  references: 90,
  depends_on: 80,
  development_depends_on: 75,
  workspace_member: 70,
  declares: 50,
  contains: 40,
};

export const REPO_GRAPH_PROJECT_RELATIONSHIP_TYPES =
  [
    "workspace_member",
    "depends_on",
    "development_depends_on",
  ] as const satisfies readonly RepoGraphEdgeType[];

export const resolveRepoGraphBuilderOptions = (
  options: RepoGraphBuilderOptions = {},
): Required<RepoGraphBuilderOptions> => ({
  maximumFiles:
    options.maximumFiles ??
    REPO_GRAPH_DEFAULTS.MAXIMUM_FILES,

  maximumSymbolsPerFile:
    options.maximumSymbolsPerFile ??
    REPO_GRAPH_DEFAULTS
      .MAXIMUM_SYMBOLS_PER_FILE,

  maximumSymbolNodes:
    options.maximumSymbolNodes ??
    REPO_GRAPH_DEFAULTS
      .MAXIMUM_SYMBOL_NODES,

  maximumNodes:
    options.maximumNodes ??
    REPO_GRAPH_DEFAULTS.MAXIMUM_NODES,

  maximumEdges:
    options.maximumEdges ??
    REPO_GRAPH_DEFAULTS.MAXIMUM_EDGES,

  maximumEvidencePerEdge:
    options.maximumEvidencePerEdge ??
    REPO_GRAPH_DEFAULTS
      .MAXIMUM_EVIDENCE_PER_EDGE,

  symbolBatchSize:
    options.symbolBatchSize ??
    REPO_GRAPH_DEFAULTS.SYMBOL_BATCH_SIZE,

  graphBatchSize:
    options.graphBatchSize ??
    REPO_GRAPH_DEFAULTS.GRAPH_BATCH_SIZE,

  maximumConsistencyRetries:
    options.maximumConsistencyRetries ??
    REPO_GRAPH_DEFAULTS
      .MAXIMUM_CONSISTENCY_RETRIES,
});

