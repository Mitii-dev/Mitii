import type { RepoGraphBuilderOptions, RepoGraphEdgeType } from "./types";

export const REPO_GRAPH_SCHEMA_VERSION = 1 as const;

export const REPO_GRAPH_DEFAULTS = {
  MAXIMUM_FILES: 20_000,

  MAXIMUM_SYMBOLS_PER_FILE: 200,

  MAXIMUM_EDGES: 250_000,

  MAXIMUM_EVIDENCE_PER_EDGE: 5,

  MAXIMUM_CONSISTENCY_RETRIES: 1,
} as const;

export const REPO_GRAPH_NODE_PREFIXES = {
  PROJECT: "project",
} as const;

export const REPO_GRAPH_EDGE_PREFIX = "edge";

export const REPO_GRAPH_EDGE_ORDER: Readonly<
  Record<RepoGraphEdgeType, number>
> = {
  contains: 10,
  declares: 20,
  imports: 30,
  references: 40,
  workspace_member: 50,
  depends_on: 60,
  development_depends_on: 70,
};

export const REPO_GRAPH_PROJECT_RELATIONSHIP_TYPES = [
  "workspace_member",
  "depends_on",
  "development_depends_on",
] as const satisfies readonly RepoGraphEdgeType[];

export const resolveRepoGraphBuilderOptions = (
  options: RepoGraphBuilderOptions = {},
): Required<RepoGraphBuilderOptions> => ({
  maximumFiles: options.maximumFiles ?? REPO_GRAPH_DEFAULTS.MAXIMUM_FILES,

  maximumSymbolsPerFile:
    options.maximumSymbolsPerFile ??
    REPO_GRAPH_DEFAULTS.MAXIMUM_SYMBOLS_PER_FILE,

  maximumEdges: options.maximumEdges ?? REPO_GRAPH_DEFAULTS.MAXIMUM_EDGES,

  maximumEvidencePerEdge:
    options.maximumEvidencePerEdge ??
    REPO_GRAPH_DEFAULTS.MAXIMUM_EVIDENCE_PER_EDGE,

  maximumConsistencyRetries:
    options.maximumConsistencyRetries ??
    REPO_GRAPH_DEFAULTS.MAXIMUM_CONSISTENCY_RETRIES,
});
