import type { RegisteredTool } from "../../internal/ToolRegistry";
import {
  defineTool,
  documentSymbolInputSchema,
  symbolLocationsOutputSchema,
} from "../../internal/ToolCatalog";
import { executeDocumentSymbol } from "../ExecuteGotoDefinition";

export const documentSymbolTool: RegisteredTool = {
  definition: defineTool({
    name: "document_symbol",
    effects: ["workspace_read"],
    description:
      "List symbols in one workspace-relative file. Uses the language server when the host attached one, otherwise the repository graph.",
    inputSchema: documentSymbolInputSchema,
    outputSchema: symbolLocationsOutputSchema,
    modelInputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Workspace-relative file path.",
        },
      },
      required: ["path"],
    },
    executeSupported: true,
  }),
  execute(ctx) {
    return executeDocumentSymbol({
      arguments: ctx.arguments,
      grant: ctx.grant,
      workspaceRoot: ctx.workspaceRoot,
      codeNavigation: ctx.ports.codeNavigation,
    });
  },
};
