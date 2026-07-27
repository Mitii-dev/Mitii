import type { RegisteredTool } from "../../internal/ToolRegistry";
import {
  defineTool,
  runReadonlyCommandInputSchema,
  runReadonlyCommandOutputSchema,
} from "../../internal/ToolCatalog";
import { executeRunReadonlyCommand } from "../ExecuteRunReadonlyCommand";

export const runReadonlyCommandTool: RegisteredTool = {
  definition: defineTool({
    name: "run_readonly_command",
    effects: ["process_execute", "workspace_read"],
    description:
      "Run an explicitly authorized read-only command as argv (no shell).",
    inputSchema: runReadonlyCommandInputSchema,
    outputSchema: runReadonlyCommandOutputSchema,
    modelInputSchema: {
      type: "object",
      properties: {
        argv: {
          type: "array",
          items: { type: "string" },
          minItems: 1,
        },
      },
      required: ["argv"],
    },
    executeSupported: true,
  }),
  async execute(ctx) {
    const result = await executeRunReadonlyCommand({
      arguments: ctx.arguments,
      grant: ctx.grant,
      workspaceRoot: ctx.workspaceRoot,
      process: ctx.ports.process,
      timeoutMs: ctx.timeoutMs,
      maxOutputBytes: ctx.maxOutputBytes,
      signal: ctx.signal,
    });
    return {
      ...result,
      argv: Array.isArray((ctx.arguments as { argv?: unknown }).argv)
        ? (ctx.arguments as { argv: string[] }).argv
        : undefined,
    };
  },
};
