import type { GitDiffResult, GitPort, GitStatusResult } from "../contracts";

export class InMemoryGitAdapter implements GitPort {
  constructor(
    private readonly statusResult: GitStatusResult = {
      branch: "main",
      staged: [],
      unstaged: [],
      untracked: [],
      raw: "",
    },
    private readonly diffResult: GitDiffResult = {
      diff: "",
      truncated: false,
    },
  ) {}

  public async status(): Promise<GitStatusResult> {
    return { ...this.statusResult, staged: [...this.statusResult.staged] };
  }

  public async diff(): Promise<GitDiffResult> {
    return { ...this.diffResult };
  }
}
