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
    description:
      "Search workspace text (preferred for content discovery). Use this to find symbols, tests, or patterns before read_file.",
    inputSchema: searchFilesInputSchema,
    outputSchema: searchFilesOutputSchema,
    modelInputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        path: { type: "string" },
        maxMatches: { type: "integer", minimum: 1, maximum: 200 },
        caseSensitive: { type: "boolean" },
      },
      required: ["query"],
    },
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
