import type { RegisteredTool } from "../../internal/ToolRegistry";
import {
  defineTool,
  searchFilesInputSchema,
  searchFilesOutputSchema,
} from "../../internal/ToolCatalog";
import { executeSearchFiles } from "../ExecuteSearchFiles";

export const searchFilesTool: RegisteredTool = {
  definition: defineTool({
    name: "search_files",
    effects: ["workspace_read"],
    description: "Search workspace text files for a query string.",
    inputSchema: searchFilesInputSchema,
    outputSchema: searchFilesOutputSchema,
    executeSupported: true,
  }),
  execute(ctx) {
    return executeSearchFiles({
      arguments: ctx.arguments,
      grant: ctx.grant,
      workspaceRoot: ctx.workspaceRoot,
      fileSystem: ctx.ports.fileSystem,
      maxOutputBytes: ctx.maxOutputBytes,
    });
  },
};
