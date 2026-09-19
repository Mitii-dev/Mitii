import type { RegisteredTool } from "../../internal/ToolRegistry";
import {
  defineTool,
  hoverSymbolInputSchema,
  hoverSymbolOutputSchema,
} from "../../internal/ToolCatalog";
import { executeHoverSymbol } from "../ExecuteGotoDefinition";

export const hoverSymbolTool: RegisteredTool = {
  definition: defineTool({
    name: "hover_symbol",
    effects: ["workspace_read"],
    description:
      "Get hover information (type signature / documentation) for a symbol at a file path and 1-based line/column. Uses the language server when available, otherwise the repository graph.",
    inputSchema: hoverSymbolInputSchema,
    outputSchema: hoverSymbolOutputSchema,
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
    return executeHoverSymbol({
      arguments: ctx.arguments,
      grant: ctx.grant,
      workspaceRoot: ctx.workspaceRoot,
      codeNavigation: ctx.ports.codeNavigation,
    });
  },
};
