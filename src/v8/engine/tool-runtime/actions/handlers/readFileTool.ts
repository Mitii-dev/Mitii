import type { RegisteredTool } from "../../internal/ToolRegistry";
import {
  defineTool,
  readFileInputSchema,
  readFileOutputSchema,
} from "../../internal/ToolCatalog";
import { executeReadFile } from "../ExecuteReadFile";

export const readFileTool: RegisteredTool = {
  definition: defineTool({
    name: "read_file",
    effects: ["workspace_read"],
    description: "Read a workspace file or line range.",
    inputSchema: readFileInputSchema,
    outputSchema: readFileOutputSchema,
    executeSupported: true,
  }),
  async execute(ctx) {
    const result = await executeReadFile({
      arguments: ctx.arguments,
      grant: ctx.grant,
      workspaceRoot: ctx.workspaceRoot,
      fileSystem: ctx.ports.fileSystem,
      maxOutputBytes: ctx.maxOutputBytes,
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
