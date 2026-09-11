import type { RegisteredTool } from "../../internal/ToolRegistry";
import {
  defineTool,
  readGitBranchesInputSchema,
  readGitBranchesOutputSchema,
  readGitLogInputSchema,
  readGitLogOutputSchema,
  readGitShowInputSchema,
  readGitShowOutputSchema,
} from "../../internal/ToolCatalog";
import {
  executeReadGitBranches,
  executeReadGitLog,
  executeReadGitShow,
} from "../ExecuteGitReadTools";

export const readGitLogTool: RegisteredTool = {
  definition: defineTool({
    name: "read_git_log",
    effects: ["workspace_read"],
    description:
      "Read recent git commits (hash, subject, author, date). Optional path filters. Read-only.",
    inputSchema: readGitLogInputSchema,
    outputSchema: readGitLogOutputSchema,
    modelInputSchema: {
      type: "object",
      properties: {
        maxCount: { type: "integer", minimum: 1, maximum: 100 },
        paths: { type: "array", items: { type: "string" } },
      },
    },
    executeSupported: true,
  }),
  execute(ctx) {
    return executeReadGitLog({
      arguments: ctx.arguments,
      workspaceRoot: ctx.workspaceRoot,
      git: ctx.ports.git,
      signal: ctx.signal,
    });
  },
};

export const readGitShowTool: RegisteredTool = {
  definition: defineTool({
    name: "read_git_show",
    effects: ["workspace_read"],
    description:
      "Show a git revision (commit/tag) or a file at that revision. Read-only.",
    inputSchema: readGitShowInputSchema,
    outputSchema: readGitShowOutputSchema,
    modelInputSchema: {
      type: "object",
      properties: {
        revision: { type: "string" },
        path: { type: "string" },
      },
      required: ["revision"],
    },
    executeSupported: true,
  }),
  execute(ctx) {
    return executeReadGitShow({
      arguments: ctx.arguments,
      workspaceRoot: ctx.workspaceRoot,
      git: ctx.ports.git,
      signal: ctx.signal,
    });
  },
};

export const readGitBranchesTool: RegisteredTool = {
  definition: defineTool({
    name: "read_git_branches",
    effects: ["workspace_read"],
    description: "List local git branches and the current branch. Read-only.",
    inputSchema: readGitBranchesInputSchema,
    outputSchema: readGitBranchesOutputSchema,
    modelInputSchema: { type: "object", properties: {} },
    executeSupported: true,
  }),
  execute(ctx) {
    return executeReadGitBranches({
      arguments: ctx.arguments,
      workspaceRoot: ctx.workspaceRoot,
      git: ctx.ports.git,
      signal: ctx.signal,
    });
  },
};
