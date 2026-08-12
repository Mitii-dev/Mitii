import type { RegisteredTool } from "../../internal/ToolRegistry";
import {
  defineTool,
  findReferencesInputSchema,
  findReferencesOutputSchema,
} from "../../internal/ToolCatalog";
import { executeFindReferences } from "../ExecuteGotoDefinition";

export const findReferencesTool: RegisteredTool = {
  definition: defineTool({
    name: "find_references",
    effects: ["workspace_read"],
    description:
      "Find references and callers for a symbol at a file path and 1-based line/column. Uses the language server when available, otherwise the repository graph.",
    inputSchema: findReferencesInputSchema,
    outputSchema: findReferencesOutputSchema,
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
        includeDeclaration: { type: "boolean" },
      },
      required: ["path", "line"],
    },
    executeSupported: true,
  }),
  execute(ctx) {
    return executeFindReferences({
      arguments: ctx.arguments,
      grant: ctx.grant,
      workspaceRoot: ctx.workspaceRoot,
      codeNavigation: ctx.ports.codeNavigation,
    });
  },
};
