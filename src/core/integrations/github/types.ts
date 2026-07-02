export interface GitHubIssueRef {
  owner: string;
  repo: string;
  number: number;
  url: string;
}

export interface GitHubIssueUser {
  login: string;
  htmlUrl?: string;
}

export interface GitHubIssueComment {
  id: number;
  body: string;
  author?: GitHubIssueUser;
  createdAt?: string;
  updatedAt?: string;
  htmlUrl?: string;
}

export interface GitHubIssue {
  ref: GitHubIssueRef;
  title: string;
  body: string;
  state: string;
  htmlUrl: string;
  labels: string[];
  assignees: GitHubIssueUser[];
  milestone?: string;
  author?: GitHubIssueUser;
  createdAt?: string;
  updatedAt?: string;
  closedAt?: string;
  comments: GitHubIssueComment[];
  totalComments: number;
}

export interface GitHubIssueFetchOptions {
  token?: string;
  maxComments?: number;
  timeoutMs?: number;
}
