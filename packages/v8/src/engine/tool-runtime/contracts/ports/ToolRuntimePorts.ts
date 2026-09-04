import type { CodeNavigationPort } from "../../../../modules/code-navigation";
import type { RepoGraph } from "../../../../modules/repository-state";
import type { DiagnosticsPort } from "./DiagnosticsPort";
import type { GitPort } from "./GitPort";
import type { NetworkPort } from "./NetworkPort";
import type { ProcessPort } from "./ProcessPort";
import type { SearchPort } from "./SearchPort";
import type { WorkspaceFileSystemPort } from "./WorkspaceFileSystemPort";

export interface ToolRuntimePorts {
  fileSystem: WorkspaceFileSystemPort;
  process: ProcessPort;
  diagnostics?: DiagnosticsPort;
  git?: GitPort;
  network?: NetworkPort;
  search?: SearchPort;
  codeNavigation?: CodeNavigationPort;
  repoGraphs?: RepositoryGraphPort;
}

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
}

export type {
  WorkspaceFileSystemPort,
  WorkspaceStat,
  WorkspaceDirectoryEntry,
  WorkspaceEntryKind,
  WorkspaceReadFileOptions,
  WorkspaceReadFileResult,
  WorkspaceReadFileTruncationReason,
} from "./WorkspaceFileSystemPort";
export type {
  ProcessPort,
  ProcessExecRequest,
  ProcessExecResult,
} from "./ProcessPort";
export type { DiagnosticsPort, DiagnosticItem } from "./DiagnosticsPort";
export type {
  GitPort,
  GitStatusResult,
  GitDiffResult,
} from "./GitPort";
export type {
  NetworkPort,
  NetworkFetchRequest,
  NetworkFetchResult,
} from "./NetworkPort";
export type {
  SearchPort,
  WebSearchRequest,
  WebSearchHit,
  WebSearchResult,
} from "./SearchPort";
export type { RepoGraph };
