import type { RegisteredTool } from "../../internal/ToolRegistry";
import {
  defineTool,
  readDiagnosticsInputSchema,
  readDiagnosticsOutputSchema,
} from "../../internal/ToolCatalog";
import { executeReadDiagnostics } from "../ExecuteReadDiagnostics";

export const readDiagnosticsTool: RegisteredTool = {
  definition: defineTool({
    name: "read_diagnostics",
    effects: ["workspace_read"],
    description: "Read workspace diagnostics for optional paths.",
    inputSchema: readDiagnosticsInputSchema,
    outputSchema: readDiagnosticsOutputSchema,
    executeSupported: true,
  }),
  execute(ctx) {
    return executeReadDiagnostics({
      arguments: ctx.arguments,
      grant: ctx.grant,
      workspaceRoot: ctx.workspaceRoot,
      fileSystem: ctx.ports.fileSystem,
      diagnostics: ctx.ports.diagnostics,
    });
  },
};
