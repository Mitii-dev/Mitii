import type { RegisteredTool } from "../../internal/ToolRegistry";
import {
  defineTool,
  findTypeDefinitionInputSchema,
  symbolLocationsOutputSchema,
} from "../../internal/ToolCatalog";
import { executeFindTypeDefinition } from "../ExecuteGotoDefinition";

export const findTypeDefinitionTool: RegisteredTool = {
  definition: defineTool({
    name: "find_type_definition",
    effects: ["workspace_read"],
    description:
      "Resolve the type definition of a symbol at a file path and 1-based line/column (e.g. the interface or class behind a value). Uses the language server when available, otherwise a type-like symbol on the repository graph.",
    inputSchema: findTypeDefinitionInputSchema,
    outputSchema: symbolLocationsOutputSchema,
    modelInputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Workspace-relative file path.",
        },
        line: { type: "integer", minimum: 1 },
        column: { type: "integer", minimum: 1 },
        symbolName: { type: "string" },
      },
      required: ["path", "line"],
    },
    executeSupported: true,
  }),
  execute(ctx) {
    return executeFindTypeDefinition({
      arguments: ctx.arguments,
      grant: ctx.grant,
      workspaceRoot: ctx.workspaceRoot,
      codeNavigation: ctx.ports.codeNavigation,
    });
  },
};
