import type { RegisteredTool } from "../../internal/ToolRegistry";
import {
  defineTool,
  readManyFilesInputSchema,
  readManyFilesOutputSchema,
} from "../../internal/ToolCatalog";
import { executeReadManyFiles } from "../ExecuteReadManyFiles";

export const readManyFilesTool: RegisteredTool = {
  definition: defineTool({
    name: "read_many_files",
    effects: ["workspace_read"],
    description:
      "Read multiple small workspace files in one call with per-file caps. Each file may include eof/nextStartLine when truncated — continue those paths with read_file(startLine=nextStartLine). Prefer after glob_files/search_files narrows candidates.",
    inputSchema: readManyFilesInputSchema,
    outputSchema: readManyFilesOutputSchema,
    modelInputSchema: {
      type: "object",
      properties: {
        paths: {
          type: "array",
          items: { type: "string" },
          minItems: 1,
          maxItems: 20,
          description: "Relative file paths to read.",
        },
        maxBytesPerFile: {
          type: "integer",
          minimum: 1,
          maximum: 128000,
        },
        maxLinesPerFile: {
          type: "integer",
          minimum: 1,
          maximum: 20000,
        },
      },
      required: ["paths"],
    },
    executeSupported: true,
  }),
  execute(ctx) {
    return executeReadManyFiles({
      arguments: ctx.arguments,
      grant: ctx.grant,
      workspaceRoot: ctx.workspaceRoot,
      fileSystem: ctx.ports.fileSystem,
      maxOutputBytes: ctx.maxOutputBytes,
      maxContentChars: ctx.maxContentChars,
    });
  },
};
