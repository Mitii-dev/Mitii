import type { RegisteredTool } from "../../internal/ToolRegistry";
import {
  defineTool,
  readGitStatusInputSchema,
  readGitStatusOutputSchema,
} from "../../internal/ToolCatalog";
import { executeReadGitStatus } from "../ExecuteReadGitStatus";

export const readGitStatusTool: RegisteredTool = {
  definition: defineTool({
    name: "read_git_status",
    effects: ["workspace_read"],
    description: "Read Git status and optional diff summary.",
    inputSchema: readGitStatusInputSchema,
    outputSchema: readGitStatusOutputSchema,
    modelInputSchema: {
      type: "object",
      properties: {
        includeDiff: { type: "boolean" },
        paths: {
          type: "array",
          items: { type: "string" },
          description: "Optional path filters for status/diff.",
        },
      },
    },
    executeSupported: true,
  }),
  execute(ctx) {
    return executeReadGitStatus({
      arguments: ctx.arguments,
      grant: ctx.grant,
      workspaceRoot: ctx.workspaceRoot,
      git: ctx.ports.git,
      maxOutputBytes: ctx.maxOutputBytes,
      signal: ctx.signal,
    });
  },
};
