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
      "Apply structured oldText/newText patches inside a recoverable transaction. Batch small: prefer ≤3 files per call (hard max from grant mutationBudget, catalog max 12). Use minimal hunks — never rewrite many whole files in one response; continue across turns for large refactors. Create new files with oldText=\"\". For deletes use delete_file/delete_directory; for renames/moves use move_file.",
    inputSchema: applyPatchInputSchema,
    outputSchema: applyPatchOutputSchema,
    modelInputSchema: {
      type: "object",
      properties: {
        patches: {
          type: "array",
          items: {
            type: "object",
            properties: {
              path: { type: "string" },
              oldText: { type: "string" },
              newText: { type: "string" },
              expectedHash: { type: "string" },
            },
            required: ["path", "oldText", "newText"],
          },
          minItems: 1,
          maxItems: 12,
        },
      },
      required: ["patches"],
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
