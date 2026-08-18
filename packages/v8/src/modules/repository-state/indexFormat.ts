/**
 * Host-persisted format keys for incremental republish.
 * Bump these when on-disk text/graph artifacts are not compatible with the
 * current builders, so `.mitii` short-circuit cannot reuse a stale index.
 */
export const REPOSITORY_INDEX_FORMAT = {
  textIndexSchemaVersion: 2,
  textPipelineVersion: "chunking-v2-identifier-fts",
  graphBuilderVersion: "graph-v3-tags-queries",
} as const;

export type RepositoryIndexFormat = typeof REPOSITORY_INDEX_FORMAT;
