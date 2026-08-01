import type { RegisteredTool } from "../../internal/ToolRegistry";
import {
  defineTool,
  globFilesInputSchema,
  globFilesOutputSchema,
} from "../../internal/ToolCatalog";
import { executeGlobFiles } from "../ExecuteGlobFiles";

export const globFilesTool: RegisteredTool = {
  definition: defineTool({
    name: "glob_files",
    effects: ["workspace_read"],
    description:
      "Find workspace paths by glob pattern (e.g. **/*.spec.ts). Prefer this over walking list_directory for locating files by name/extension.",
    inputSchema: globFilesInputSchema,
    outputSchema: globFilesOutputSchema,
    modelInputSchema: {
      type: "object",
      properties: {
        pattern: {
          type: "string",
          description: "Glob pattern relative to path (supports *, ?, **).",
        },
        path: {
          type: "string",
          description: "Relative directory to search under (default \".\").",
        },
        maxResults: {
          type: "integer",
          minimum: 1,
          maximum: 500,
        },
      },
      required: ["pattern"],
    },
    executeSupported: true,
  }),
  async execute(ctx) {
    const result = await executeGlobFiles({
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
