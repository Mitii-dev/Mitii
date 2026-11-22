import type { CodeNavigationPort } from "../../../../modules/code-navigation";
import type { KnowledgeGraphPort } from "../../../../modules/memory";
import type { RepositoryGraphPort } from "../../../../modules/change-impact";
import type { RepoGraph } from "../../../../modules/repository-state";
import type { DiagnosticsPort } from "./DiagnosticsPort";
import type { GitPort } from "./GitPort";
import type { NetworkPort } from "./NetworkPort";
import type { ProcessPort } from "./ProcessPort";
import type { SearchPort } from "./SearchPort";
import type { ToolOutputSpillPort } from "./ToolOutputSpillPort";
import type { WorkspaceFileSystemPort } from "./WorkspaceFileSystemPort";
import type { AstGrepPort } from "./AstGrepPort";
import type { WorkspaceTextSearchPort } from "./WorkspaceTextSearchPort";

export interface ToolRuntimePorts {
  fileSystem: WorkspaceFileSystemPort;
  process: ProcessPort;
  diagnostics?: DiagnosticsPort;
  git?: GitPort;
  network?: NetworkPort;
  search?: SearchPort;
  /** Live repo text search (ripgrep / FTS). Falls back to FS walk when omitted. */
  workspaceTextSearch?: WorkspaceTextSearchPort;
  /** Structural AST search (ast-grep). Off the index hot path. */
  astGrep?: AstGrepPort;
  /** Optional full-payload store when model-facing output is byte-bounded. */
  outputSpill?: ToolOutputSpillPort;
  codeNavigation?: CodeNavigationPort;
  repoGraphs?: RepositoryGraphPort;
  /** Optional relational memory beside MemoryFact pipeline. */
  knowledgeGraph?: KnowledgeGraphPort;
}

/** Owned by Change Impact; re-exported so tool hosts keep one import path. */
export type { RepositoryGraphPort };

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
export type {
  DiagnosticsPort,
  DiagnosticItem,
  DiagnosticsSettleOptions,
} from "./DiagnosticsPort";
export type {
  GitPort,
  GitStatusResult,
  GitDiffResult,
  GitLogEntry,
  GitLogResult,
  GitShowResult,
  GitBranchListResult,
} from "./GitPort";
export type { KnowledgeGraphPort } from "../../../../modules/memory";
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
export type {
  WorkspaceTextSearchPort,
  WorkspaceTextSearchMatch,
  WorkspaceTextSearchRequest,
  WorkspaceTextSearchResult,
} from "./WorkspaceTextSearchPort";
export type {
  AstGrepPort,
  AstGrepMatch,
  AstGrepSearchRequest,
  AstGrepSearchResult,
} from "./AstGrepPort";
export type {
  ToolOutputSpillPort,
  ToolOutputSpillStoreRequest,
  ToolOutputSpillStoreResult,
} from "./ToolOutputSpillPort";
export type { RepoGraph };
