import { z } from "zod";

import type { RegisteredTool } from "../../internal/ToolRegistry";
import { defineTool } from "../../internal/ToolCatalog";
import { getBuiltinModelToolDefinition } from "./builtinModelLookup";

export const describeToolInputSchema = z
  .object({
    name: z.string().min(1).max(128),
  })
  .strict();

export const describeToolOutputSchema = z
  .object({
    name: z.string(),
    description: z.string(),
    inputSchema: z.record(z.string(), z.unknown()),
    found: z.boolean(),
  })
  .strict();

/**
 * Progressive disclosure meta-tool. Returns the full model-facing JSON Schema
 * for a tool the grant already allows. Cannot unlock tools outside the grant
 * (Tool Runtime preflight + Decision Policy).
 */
export const describeToolTool: RegisteredTool = {
  definition: defineTool({
    name: "describe_tool",
    effects: ["workspace_read"],
    backend: "local",
    status: "available",
    description:
      "Load the full parameter JSON Schema for one granted tool by name. " +
      "Call this before using a tool whose index stub is too brief. " +
      "Cannot unlock tools Decision Policy did not grant.",
    inputSchema: describeToolInputSchema,
    outputSchema: describeToolOutputSchema,
    modelInputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Exact tool name from the tool index (e.g. read_file).",
        },
      },
      required: ["name"],
    },
    executeSupported: true,
  }),
  async execute(ctx) {
    const parsed = describeToolInputSchema.safeParse(ctx.arguments);
    if (!parsed.success) {
      return {
        output: {
          name: "",
          description: "",
          inputSchema: {},
          found: false,
        },
        truncated: false,
        redacted: false,
        warnings: [parsed.error.message],
      };
    }

    const name = parsed.data.name.trim();
    if (!ctx.grant.allowedTools.includes(name) && name !== "describe_tool") {
      return {
        output: {
          name,
          description: "",
          inputSchema: {},
          found: false,
        },
        truncated: false,
        redacted: false,
        warnings: [`Tool "${name}" is not in the current grant.`],
      };
    }

    const match = getBuiltinModelToolDefinition(name);
    if (!match) {
      return {
        output: {
          name,
          description: "",
          inputSchema: {},
          found: false,
        },
        truncated: false,
        redacted: false,
        warnings: [`Unknown tool: ${name}`],
      };
    }

    return {
      output: {
        name: match.name,
        description: match.description,
        inputSchema: { ...match.inputSchema },
        found: true,
      },
      truncated: false,
      redacted: false,
      warnings: [],
    };
  },
};
