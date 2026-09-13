import type { RegisteredTool } from "../../internal/ToolRegistry";
import {
  defineTool,
  directoryTreeInputSchema,
  directoryTreeOutputSchema,
} from "../../internal/ToolCatalog";
import { executeDirectoryTree } from "../ExecuteDirectoryTree";

export const directoryTreeTool: RegisteredTool = {
  definition: defineTool({
    name: "directory_tree",
    effects: ["workspace_read"],
    description:
      "Return a recursive JSON directory tree under a workspace path. Skips .git/node_modules by default; pass excludeNames to skip more. Prefer this for orientation; use glob_files for pattern search.",
    inputSchema: directoryTreeInputSchema,
    outputSchema: directoryTreeOutputSchema,
    modelInputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
        maxDepth: { type: "integer", minimum: 1, maximum: 20 },
        maxEntries: { type: "integer", minimum: 1 },
        excludeNames: {
          type: "array",
          items: { type: "string" },
        },
      },
    },
    executeSupported: true,
  }),
  execute(ctx) {
    return executeDirectoryTree({
      arguments: ctx.arguments,
      grant: ctx.grant,
      workspaceRoot: ctx.workspaceRoot,
      fileSystem: ctx.ports.fileSystem,
    });
  },
};
