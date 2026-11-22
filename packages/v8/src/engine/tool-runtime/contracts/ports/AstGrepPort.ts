/**
 * Structural AST search (ast-grep). Complementary to text search_files.
 */

export interface AstGrepMatch {
  path: string;
  line: number;
  text: string;
}

export interface AstGrepSearchRequest {
  workspaceRoot: string;
  searchRoot: string;
  pattern: string;
  language?: string;
  maxMatches: number;
  signal?: AbortSignal;
}

export interface AstGrepSearchResult {
  matches: AstGrepMatch[];
  truncated: boolean;
  available: boolean;
  warning?: string;
}

export interface AstGrepPort {
  search(request: AstGrepSearchRequest): Promise<AstGrepSearchResult>;
}
