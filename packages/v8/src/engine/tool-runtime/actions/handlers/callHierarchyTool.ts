import type { RegisteredTool } from "../../internal/ToolRegistry";
import {
  callHierarchyInputSchema,
  defineTool,
  symbolLocationsOutputSchema,
} from "../../internal/ToolCatalog";
import { executeCallHierarchy } from "../ExecuteGotoDefinition";

export const callHierarchyTool: RegisteredTool = {
  definition: defineTool({
    name: "call_hierarchy",
    effects: ["workspace_read"],
    description:
      "List callers (incoming) or callees (outgoing, default) of a symbol at a file path and 1-based line/column. Uses the language server when attached, otherwise call edges on the repository graph.",
    inputSchema: callHierarchyInputSchema,
    outputSchema: symbolLocationsOutputSchema,
    modelInputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Workspace-relative file path." },
        line: { type: "integer", minimum: 1 },
        column: { type: "integer", minimum: 1 },
        symbolName: { type: "string" },
        direction: { type: "string", enum: ["incoming", "outgoing"] },
      },
      required: ["path", "line"],
    },
    executeSupported: true,
  }),
  execute(ctx) {
    return executeCallHierarchy({
      arguments: ctx.arguments,
      grant: ctx.grant,
      workspaceRoot: ctx.workspaceRoot,
      codeNavigation: ctx.ports.codeNavigation,
    });
  },
};
