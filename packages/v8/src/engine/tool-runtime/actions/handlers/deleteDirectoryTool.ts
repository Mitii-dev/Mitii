import type { RegisteredTool } from "../../internal/ToolRegistry";
import {
  defineTool,
  deleteDirectoryInputSchema,
  deleteDirectoryOutputSchema,
} from "../../internal/ToolCatalog";
import { MutationError } from "../../internal/mutation";
import { executeDeleteDirectory } from "../ExecuteDeleteDirectory";

export const deleteDirectoryTool: RegisteredTool = {
  definition: defineTool({
    name: "delete_directory",
    effects: ["workspace_write"],
    description:
      "Delete a workspace directory inside a recoverable transaction. Defaults to recursive=true. Prefer this over shell rm or apply_patch for directory removals.",
    inputSchema: deleteDirectoryInputSchema,
    outputSchema: deleteDirectoryOutputSchema,
    modelInputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
        recursive: { type: "boolean" },
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
    return executeDeleteDirectory({
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
