import type { RegisteredTool } from "../../internal/ToolRegistry";
import {
  defineTool,
  findImplementationInputSchema,
  symbolLocationsOutputSchema,
} from "../../internal/ToolCatalog";
import { executeFindImplementation } from "../ExecuteGotoDefinition";

export const findImplementationTool: RegisteredTool = {
  definition: defineTool({
    name: "find_implementation",
    effects: ["workspace_read"],
    description:
      "Find implementations of a symbol at a file path and 1-based line/column. Uses the language server when the host attached one, otherwise implements-edges on the repository graph.",
    inputSchema: findImplementationInputSchema,
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
    return executeFindImplementation({
      arguments: ctx.arguments,
      grant: ctx.grant,
      workspaceRoot: ctx.workspaceRoot,
      codeNavigation: ctx.ports.codeNavigation,
    });
  },
};
