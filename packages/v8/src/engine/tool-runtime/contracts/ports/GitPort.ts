export interface GitStatusResult {
  branch?: string;
  staged: string[];
  unstaged: string[];
  untracked: string[];
  raw: string;
}

export interface GitDiffResult {
  diff: string;
  truncated: boolean;
}

export interface GitLogEntry {
  hash: string;
  subject: string;
  authorName?: string;
  authorEmail?: string;
  authoredAt?: string;
}

export interface GitLogResult {
  entries: GitLogEntry[];
  truncated: boolean;
}

export interface GitShowResult {
  revision: string;
  content: string;
  truncated: boolean;
}

export interface GitBranchListResult {
  current?: string;
  branches: string[];
  truncated: boolean;
}

/**
 * Host git access. `status` + `diff` are required; log/show/listBranches are
 * optional so existing test stubs stay valid.
 */
export interface GitPort {
  status(params: {
    workspaceRoot: string;
    signal?: AbortSignal;
  }): Promise<GitStatusResult>;
  diff(params: {
    workspaceRoot: string;
    paths?: readonly string[];
    staged?: boolean;
    signal?: AbortSignal;
  }): Promise<GitDiffResult>;
  log?(params: {
    workspaceRoot: string;
    maxCount?: number;
    paths?: readonly string[];
    signal?: AbortSignal;
  }): Promise<GitLogResult>;
  show?(params: {
    workspaceRoot: string;
    revision: string;
    path?: string;
    signal?: AbortSignal;
  }): Promise<GitShowResult>;
  listBranches?(params: {
    workspaceRoot: string;
    signal?: AbortSignal;
  }): Promise<GitBranchListResult>;
}
