import type { RegisteredTool } from "../../internal/ToolRegistry";
import {
  defineTool,
  readPackageScriptsInputSchema,
  readPackageScriptsOutputSchema,
} from "../../internal/ToolCatalog";
import { executeReadPackageScripts } from "../ExecuteReadPackageScripts";

export const readPackageScriptsTool: RegisteredTool = {
  definition: defineTool({
    name: "read_package_scripts",
    effects: ["workspace_read"],
    description:
      "Read scripts from a trusted package.json (or similar) manifest. Prefer this over guessing script names.",
    inputSchema: readPackageScriptsInputSchema,
    outputSchema: readPackageScriptsOutputSchema,
    modelInputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Relative path to package.json (default package.json).",
        },
      },
    },
    executeSupported: true,
  }),
  async execute(ctx) {
    const result = await executeReadPackageScripts({
      arguments: ctx.arguments,
      grant: ctx.grant,
      workspaceRoot: ctx.workspaceRoot,
      fileSystem: ctx.ports.fileSystem,
      maxOutputBytes: ctx.maxOutputBytes,
    });
    return {
      ...result,
      path:
        typeof (result.output as { path?: string }).path === "string"
          ? (result.output as { path: string }).path
          : undefined,
    };
  },
};
