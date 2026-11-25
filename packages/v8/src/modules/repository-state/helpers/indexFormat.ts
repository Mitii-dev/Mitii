/**
 * Host-persisted format keys for incremental republish.
 * Bump these when on-disk text/graph artifacts are not compatible with the
 * current builders, so `.mitii` short-circuit cannot reuse a stale index.
 */
export const REPOSITORY_INDEX_FORMAT = {
  textIndexSchemaVersion: 3,
  textPipelineVersion: "chunking-v3-collapse-trigram",
  graphBuilderVersion: "graph-v4-scip-enrichment",
} as const;

export type RepositoryIndexFormat = typeof REPOSITORY_INDEX_FORMAT;
