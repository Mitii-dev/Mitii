import type { RegisteredTool } from "../../internal/ToolRegistry";
import {
  defineTool,
  moveFileInputSchema,
  moveFileOutputSchema,
} from "../../internal/ToolCatalog";
import { MutationError } from "../../internal/mutation";
import { executeMoveFile } from "../ExecuteMoveFile";

export const moveFileTool: RegisteredTool = {
  definition: defineTool({
    name: "move_file",
    effects: ["workspace_write"],
    description:
      "Move or rename a workspace file or directory inside a recoverable transaction. Destination must not already exist. Prefer this over apply_patch or shell mv for moves.",
    inputSchema: moveFileInputSchema,
    outputSchema: moveFileOutputSchema,
    modelInputSchema: {
      type: "object",
      properties: {
        from: { type: "string" },
        to: { type: "string" },
      },
      required: ["from", "to"],
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
    return executeMoveFile({
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
