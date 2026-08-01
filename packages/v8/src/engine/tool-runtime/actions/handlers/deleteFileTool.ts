import type { RegisteredTool } from "../../internal/ToolRegistry";
import {
  defineTool,
  deleteFileInputSchema,
  deleteFileOutputSchema,
} from "../../internal/ToolCatalog";
import { MutationError } from "../../internal/mutation";
import { executeDeleteFile } from "../ExecuteDeleteFile";

export const deleteFileTool: RegisteredTool = {
  definition: defineTool({
    name: "delete_file",
    effects: ["workspace_write"],
    description:
      "Delete a single workspace file inside a recoverable transaction. Prefer this over apply_patch for removals. Use delete_directory for directories.",
    inputSchema: deleteFileInputSchema,
    outputSchema: deleteFileOutputSchema,
    modelInputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
      },
      required: ["path"],
    },
    executeSupported: true,
  }),
  async execute(ctx) {
    if (!ctx.transactions) {
      throw new MutationError(
        "execution_failed",
        "Mutation transaction registry is not configured.",
      );
    }
    return executeDeleteFile({
      arguments: ctx.arguments,
      grant: ctx.grant,
      workspaceRoot: ctx.workspaceRoot,
      fileSystem: ctx.ports.fileSystem,
      transactions: ctx.transactions,
      dirtyPaths: ctx.dirtyPaths,
      alreadyMutatedPaths: ctx.alreadyMutatedPaths,
    });
  },
};
