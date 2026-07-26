import type { RegisteredTool } from "../../internal/ToolRegistry";
import {
  applyPatchInputSchema,
  applyPatchOutputSchema,
  defineTool,
} from "../../internal/ToolCatalog";
import { MutationError } from "../../internal/mutation";
import { executeApplyPatch } from "../ExecuteApplyPatch";

export const applyPatchTool: RegisteredTool = {
  definition: defineTool({
    name: "apply_patch",
    effects: ["workspace_write"],
    description:
      "Apply one or more structured oldText/newText patches inside a recoverable mutation transaction.",
    inputSchema: applyPatchInputSchema,
    outputSchema: applyPatchOutputSchema,
    executeSupported: true,
  }),
  async execute(ctx) {
    if (!ctx.transactions) {
      throw new MutationError(
        "execution_failed",
        "Mutation transaction registry is not configured.",
      );
    }
    const result = await executeApplyPatch({
      arguments: ctx.arguments,
      grant: ctx.grant,
      workspaceRoot: ctx.workspaceRoot,
      fileSystem: ctx.ports.fileSystem,
      transactions: ctx.transactions,
      dirtyPaths: ctx.dirtyPaths,
      alreadyMutatedPaths: ctx.alreadyMutatedPaths,
    });
    return result;
  },
};
