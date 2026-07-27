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
}

export type {
  WorkspaceFileSystemPort,
  WorkspaceStat,
  WorkspaceDirectoryEntry,
  WorkspaceEntryKind,
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
