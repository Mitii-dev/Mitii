import type {
  GitBranchListResult,
  GitDiffResult,
  GitLogResult,
  GitPort,
  GitShowResult,
  GitStatusResult,
} from "../contracts";

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
    private readonly logResult: GitLogResult = {
      entries: [],
      truncated: false,
    },
    private readonly showResult: GitShowResult = {
      revision: "HEAD",
      content: "",
      truncated: false,
    },
    private readonly branchResult: GitBranchListResult = {
      current: "main",
      branches: ["main"],
      truncated: false,
    },
  ) {}

  public async status(): Promise<GitStatusResult> {
    return { ...this.statusResult, staged: [...this.statusResult.staged] };
  }

  public async diff(): Promise<GitDiffResult> {
    return { ...this.diffResult };
  }

  public async log(): Promise<GitLogResult> {
    return {
      ...this.logResult,
      entries: this.logResult.entries.map((e) => ({ ...e })),
    };
  }

  public async show(): Promise<GitShowResult> {
    return { ...this.showResult };
  }

  public async listBranches(): Promise<GitBranchListResult> {
    return {
      ...this.branchResult,
      branches: [...this.branchResult.branches],
    };
  }
}
