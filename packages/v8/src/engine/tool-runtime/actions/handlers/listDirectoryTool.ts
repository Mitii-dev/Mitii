import type { RegisteredTool } from "../../internal/ToolRegistry";
import {
  defineTool,
  listDirectoryInputSchema,
  listDirectoryOutputSchema,
} from "../../internal/ToolCatalog";
import { executeListDirectory } from "../ExecuteListDirectory";

export const listDirectoryTool: RegisteredTool = {
  definition: defineTool({
    name: "list_directory",
    effects: ["workspace_read"],
    description:
      "List entries in a workspace directory. Prefer this, glob_files, or search_files before opening many files with read_file.",
    inputSchema: listDirectoryInputSchema,
    outputSchema: listDirectoryOutputSchema,
    modelInputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Relative directory path." },
      },
    },
    executeSupported: true,
  }),
  async execute(ctx) {
    const result = await executeListDirectory({
      arguments: ctx.arguments,
      grant: ctx.grant,
      workspaceRoot: ctx.workspaceRoot,
      fileSystem: ctx.ports.fileSystem,
    });
    return {
      ...result,
      path:
        typeof (result.output as { path?: string }).path === "string"
          ? (result.output as { path: string }).path
          : undefined,
    };
  },
};
