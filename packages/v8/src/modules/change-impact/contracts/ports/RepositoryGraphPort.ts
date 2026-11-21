import type { RepoGraph } from "../../../repository-state";

/** Host port supplying published repo graphs to change-impact consumers. */
export interface RepositoryGraphPort {
  loadGraphs: () =>
    | readonly RepoGraph[]
    | Promise<readonly RepoGraph[]>;
  /**
   * Optional expected/live code-index change token for the selected graph.
   * When provided and different from `graph.codeIndexChangeToken`, change-impact
   * reports `graph_stale`. Hosts should return a live/workspace dirty watermark
   * when files changed after the graph was published — not only the revision
   * recorded alongside the artifact.
   */
  expectedCodeIndexChangeToken?: (
    graph: RepoGraph,
  ) => string | undefined | Promise<string | undefined>;
  /**
   * Optional published RepoMap importance by relative path (PageRank or
   * composite). Change-impact only applies these scores — it never recomputes.
   */
  loadImportanceByRelativePath?: () =>
    | ReadonlyMap<string, number>
    | Readonly<Record<string, number>>
    | Promise<
        ReadonlyMap<string, number> | Readonly<Record<string, number>> | undefined
      >
    | undefined;
}
