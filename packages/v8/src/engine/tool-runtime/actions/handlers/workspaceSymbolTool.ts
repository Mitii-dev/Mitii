import type { RegisteredTool } from "../../internal/ToolRegistry";
import {
  defineTool,
  symbolLocationsOutputSchema,
  workspaceSymbolInputSchema,
} from "../../internal/ToolCatalog";
import { executeWorkspaceSymbol } from "../ExecuteGotoDefinition";

export const workspaceSymbolTool: RegisteredTool = {
  definition: defineTool({
    name: "workspace_symbol",
    effects: ["workspace_read"],
    description:
      "Search symbols across the workspace by name fragment. Uses the language server when the host attached one, otherwise the repository graph.",
    inputSchema: workspaceSymbolInputSchema,
    outputSchema: symbolLocationsOutputSchema,
    modelInputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Symbol name or fragment to search for.",
        },
      },
      required: ["query"],
    },
    executeSupported: true,
  }),
  execute(ctx) {
    return executeWorkspaceSymbol({
      arguments: ctx.arguments,
      grant: ctx.grant,
      workspaceRoot: ctx.workspaceRoot,
      codeNavigation: ctx.ports.codeNavigation,
    });
  },
};
