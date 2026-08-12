import type { RegisteredTool } from "../../internal/ToolRegistry";
import {
  defineTool,
  gotoDefinitionInputSchema,
  gotoDefinitionOutputSchema,
} from "../../internal/ToolCatalog";
import { executeGotoDefinition } from "../ExecuteGotoDefinition";

export const gotoDefinitionTool: RegisteredTool = {
  definition: defineTool({
    name: "goto_definition",
    effects: ["workspace_read"],
    description:
      "Resolve the definition of a symbol at a file path and 1-based line/column. Uses the language server when available, otherwise the repository graph.",
    inputSchema: gotoDefinitionInputSchema,
    outputSchema: gotoDefinitionOutputSchema,
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
    return executeGotoDefinition({
      arguments: ctx.arguments,
      grant: ctx.grant,
      workspaceRoot: ctx.workspaceRoot,
      codeNavigation: ctx.ports.codeNavigation,
    });
  },
};
