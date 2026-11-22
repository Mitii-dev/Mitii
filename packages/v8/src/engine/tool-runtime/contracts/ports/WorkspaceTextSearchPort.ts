/**
 * Live workspace text search for `search_files` (ripgrep / FTS / FS backends).
 */

export interface WorkspaceTextSearchMatch {
  path: string;
  line: number;
  text: string;
}

export interface WorkspaceTextSearchRequest {
  workspaceRoot: string;
  /** Absolute directory or file to search within. */
  searchRoot: string;
  /** Relative path of searchRoot from workspaceRoot (posix). */
  searchRootRelative: string;
  query: string;
  mode: "literal" | "regex";
  caseSensitive: boolean;
  maxMatches: number;
  pathScopes: readonly string[];
  signal?: AbortSignal;
}

export interface WorkspaceTextSearchResult {
  matches: WorkspaceTextSearchMatch[];
  truncated: boolean;
  /** Backend that produced the result (for warnings / telemetry). */
  backend: "ripgrep" | "fts" | "filesystem";
  warning?: string;
}

export interface WorkspaceTextSearchPort {
  search(
    request: WorkspaceTextSearchRequest,
  ): Promise<WorkspaceTextSearchResult>;
}
