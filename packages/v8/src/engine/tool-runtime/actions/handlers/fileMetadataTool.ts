import type { RegisteredTool } from "../../internal/ToolRegistry";
import {
  defineTool,
  fileMetadataInputSchema,
  fileMetadataOutputSchema,
} from "../../internal/ToolCatalog";
import { executeFileMetadata } from "../ExecuteFileMetadata";

export const fileMetadataTool: RegisteredTool = {
  definition: defineTool({
    name: "file_metadata",
    effects: ["workspace_read"],
    description:
      "Return size, mtime, kind, symlink flag, and optional sha256 for a workspace path. Use before patching to detect dirty/stale files.",
    inputSchema: fileMetadataInputSchema,
    outputSchema: fileMetadataOutputSchema,
    modelInputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Relative workspace path." },
        includeHash: {
          type: "boolean",
          description: "When true (default for files), include sha256 of content (capped).",
        },
      },
      required: ["path"],
    },
    executeSupported: true,
  }),
  async execute(ctx) {
    const result = await executeFileMetadata({
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
