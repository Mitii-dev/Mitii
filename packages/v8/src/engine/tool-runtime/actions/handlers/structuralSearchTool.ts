import type { RegisteredTool } from "../../internal/ToolRegistry";
import {
  defineTool,
  structuralSearchInputSchema,
  structuralSearchOutputSchema,
} from "../../internal/ToolCatalog";
import { executeStructuralSearch } from "../ExecuteStructuralSearch";

export const structuralSearchTool: RegisteredTool = {
  definition: defineTool({
    name: "structural_search",
    effects: ["workspace_read"],
    description:
      "AST structural search via ast-grep (pattern matches code shape, not plain text). Use for finding call shapes, class forms, or syntax patterns after search_files narrows text candidates.",
    inputSchema: structuralSearchInputSchema,
    outputSchema: structuralSearchOutputSchema,
    modelInputSchema: {
      type: "object",
      properties: {
        pattern: { type: "string" },
        path: { type: "string" },
        language: { type: "string" },
        maxMatches: { type: "integer", minimum: 1, maximum: 200 },
      },
      required: ["pattern"],
    },
    executeSupported: true,
  }),
  execute(ctx) {
    return executeStructuralSearch({
      arguments: ctx.arguments,
      grant: ctx.grant,
      workspaceRoot: ctx.workspaceRoot,
      fileSystem: ctx.ports.fileSystem,
      ...(ctx.ports.astGrep ? { astGrep: ctx.ports.astGrep } : {}),
      maxOutputBytes: ctx.maxOutputBytes,
    });
  },
};
