import type { RegisteredTool } from "../../internal/ToolRegistry";
import {
  defineTool,
  sequentialThinkingInputSchema,
  sequentialThinkingOutputSchema,
} from "../../internal/ToolCatalog";
import { executeSequentialThinking } from "../ExecuteSequentialThinking";

export const sequentialThinkingTool: RegisteredTool = {
  definition: defineTool({
    name: "sequential_thinking",
    effects: ["workspace_read"],
    backend: "local",
    status: "available",
    description:
      "Use for multi-step reasoning: hypotheses, revisions, and branches. " +
      "Set nextThoughtNeeded=true until analysis is complete; set isRevision/revisesThought " +
      "to correct earlier thoughts; use branchFromThought+branchId to explore alternatives. " +
      "Auto-extends totalThoughts when thoughtNumber exceeds it. Local bookkeeping only — no filesystem writes.",
    inputSchema: sequentialThinkingInputSchema,
    outputSchema: sequentialThinkingOutputSchema,
    modelInputSchema: {
      type: "object",
      properties: {
        thought: { type: "string" },
        thoughtNumber: { type: "integer", minimum: 1 },
        totalThoughts: { type: "integer", minimum: 1 },
        nextThoughtNeeded: { type: "boolean" },
        isRevision: { type: "boolean" },
        revisesThought: { type: "integer", minimum: 1 },
        branchFromThought: { type: "integer", minimum: 1 },
        branchId: { type: "string" },
        needsMoreThoughts: { type: "boolean" },
      },
      required: [
        "thought",
        "thoughtNumber",
        "totalThoughts",
        "nextThoughtNeeded",
      ],
    },
    executeSupported: true,
  }),
  execute(ctx) {
    return executeSequentialThinking({
      arguments: ctx.arguments,
      workspaceRoot: ctx.workspaceRoot,
    });
  },
};
