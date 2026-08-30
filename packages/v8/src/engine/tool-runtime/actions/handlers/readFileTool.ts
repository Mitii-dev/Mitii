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
    description:
      "Read a workspace file or line range. Returns actual startLine/endLine coverage, eof, and nextStartLine when truncated — call again with startLine=nextStartLine for the remainder instead of re-reading from line 1. Prefer glob_files/search_files/list_directory first; use read_many_files for multiple small files. For edits, use minimal apply_patch hunks from the window you have; do not rewrite whole files.",
    inputSchema: readFileInputSchema,
    outputSchema: readFileOutputSchema,
    modelInputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
        startLine: { type: "integer", minimum: 1 },
        endLine: { type: "integer", minimum: 1 },
        maxLines: { type: "integer", minimum: 1 },
      },
      required: ["path"],
    },
    executeSupported: true,
  }),
  async execute(ctx) {
    const result = await executeReadFile({
      arguments: ctx.arguments,
      grant: ctx.grant,
      workspaceRoot: ctx.workspaceRoot,
      fileSystem: ctx.ports.fileSystem,
      maxOutputBytes: ctx.maxOutputBytes,
      maxContentChars: ctx.maxContentChars,
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
