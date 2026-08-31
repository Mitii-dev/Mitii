import type { RegisteredTool } from "../../internal/ToolRegistry";
import {
  createGithubIssueInputSchema,
  createPullRequestInputSchema,
  defineTool,
  githubMutationOutputSchema,
} from "../../internal/ToolCatalog";
import {
  executeCreateGithubIssue,
  executeCreatePullRequest,
} from "../ExecuteGithubMutation";

export const createGithubIssueTool: RegisteredTool = {
  definition: defineTool({
    name: "create_github_issue",
    effects: ["process_execute", "external_write"],
    backend: "local",
    status: "available",
    description:
      "Create a GitHub issue via `gh issue create` (argv-only). Use for automation triage tickets.",
    inputSchema: createGithubIssueInputSchema,
    outputSchema: githubMutationOutputSchema,
    modelInputSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        body: { type: "string" },
        labels: { type: "array", items: { type: "string" } },
        assignees: { type: "array", items: { type: "string" } },
      },
      required: ["title", "body"],
    },
    executeSupported: true,
  }),
  async execute(ctx) {
    return executeCreateGithubIssue({
      arguments: ctx.arguments,
      grant: ctx.grant,
      workspaceRoot: ctx.workspaceRoot,
      process: ctx.ports.process,
      timeoutMs: ctx.timeoutMs,
      maxOutputBytes: ctx.maxOutputBytes,
      signal: ctx.signal,
    });
  },
};

export const createPullRequestTool: RegisteredTool = {
  definition: defineTool({
    name: "create_pull_request",
    effects: ["process_execute", "external_write", "git_write"],
    backend: "local",
    status: "available",
    description:
      "Open a draft GitHub pull request via `gh pr create` (argv-only). Refuses head=main/master.",
    inputSchema: createPullRequestInputSchema,
    outputSchema: githubMutationOutputSchema,
    modelInputSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        body: { type: "string" },
        head: { type: "string" },
        base: { type: "string" },
        draft: { type: "boolean" },
      },
      required: ["title", "body", "head"],
    },
    executeSupported: true,
  }),
  async execute(ctx) {
    return executeCreatePullRequest({
      arguments: ctx.arguments,
      grant: ctx.grant,
      workspaceRoot: ctx.workspaceRoot,
      process: ctx.ports.process,
      timeoutMs: ctx.timeoutMs,
      maxOutputBytes: ctx.maxOutputBytes,
      signal: ctx.signal,
    });
  },
};
