import type { RegisteredTool } from "../../internal/ToolRegistry";
import {
  defineTool,
  runCommandInputSchema,
  runCommandOutputSchema,
} from "../../internal/ToolCatalog";
import { executeRunCommand } from "../ExecuteRunCommand";

/**
 * Mutating argv command. Decision Policy grants this only on agent execute
 * paths that need process verification; Tool Runtime still enforces write
 * authority, approval, argv-only prefixes, and workspace cwd.
 */
export const runCommandTool: RegisteredTool = {
  definition: defineTool({
    name: "run_command",
    effects: ["process_execute", "workspace_write"],
    backend: "local",
    status: "available",
    description:
      "Run an authorized mutating command as argv (no shell). Requires write grant, approval when configured, and matching commandRules prefixes.",
    inputSchema: runCommandInputSchema,
    outputSchema: runCommandOutputSchema,
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
    const result = await executeRunCommand({
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
