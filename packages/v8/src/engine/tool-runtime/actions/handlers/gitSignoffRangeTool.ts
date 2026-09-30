import type { RegisteredTool } from "../../internal/ToolRegistry";
import {
  defineTool,
  gitSignoffRangeInputSchema,
  gitSignoffRangeOutputSchema,
} from "../../internal/ToolCatalog";
import { executeGitSignoffRange } from "../ExecuteGitSignoffRange";

export const gitSignoffRangeTool: RegisteredTool = {
  definition: defineTool({
    name: "git_signoff_range",
    effects: ["process_execute", "git_write"],
    backend: "local",
    status: "available",
    description:
      "Add Signed-off-by trailers to every commit after an exclusive base ref (DCO fix). Stashes a dirty tree, runs `git rebase --exec 'git commit --amend --no-edit --signoff' <base>`, restores the stash, and optionally `git push --force-with-lease` to the current feature branch. Refuses main/master and detached HEAD. Prefer this over editing .github/workflows/dco.yml or freeform git via run_command.",
    inputSchema: gitSignoffRangeInputSchema,
    outputSchema: gitSignoffRangeOutputSchema,
    modelInputSchema: {
      type: "object",
      properties: {
        base: {
          type: "string",
          description:
            "Exclusive base commit/ref from the DCO range (e.g. 9ee7a42).",
        },
        push: {
          type: "boolean",
          description:
            "When true, push --force-with-lease current branch to remote after rebase.",
        },
        remote: {
          type: "string",
          description: "Remote name for push (default origin).",
        },
      },
      required: ["base"],
    },
    executeSupported: true,
  }),
  async execute(ctx) {
    return executeGitSignoffRange({
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
