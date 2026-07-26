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
}
