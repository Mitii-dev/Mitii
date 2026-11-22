import type { RegisteredTool } from "../../internal/ToolRegistry";
import {
  defineTool,
  planCheckChangeImpactInputSchema,
  planCheckChangeImpactOutputSchema,
} from "../../internal/ToolCatalog";
import { executePlanCheckChangeImpact } from "../ExecutePlanCheckChangeImpact";

export const planCheckChangeImpactTool: RegisteredTool = {
  definition: defineTool({
    name: "plan_check_change_impact",
    effects: ["workspace_read"],
    description:
      "Counterfactual blast-radius check for proposed file paths before writing. Walks the repository graph as if those paths change, reports affected files/packages, optional package spillover vs expectedPackages, and whether verification should widen. Does not mutate the working tree.",
    inputSchema: planCheckChangeImpactInputSchema,
    outputSchema: planCheckChangeImpactOutputSchema,
    modelInputSchema: {
      type: "object",
      properties: {
        proposedPaths: {
          type: "array",
          items: { type: "string" },
          description:
            "Workspace-relative paths proposed to change (counterfactual seeds).",
        },
        expectedPackages: {
          type: "array",
          items: { type: "string" },
          description:
            "Optional package names/ids that should contain the blast radius. Spillover is reported when impact leaves this set.",
        },
        maximumHops: { type: "integer", minimum: 1, maximum: 6 },
        maximumAffectedNodes: { type: "integer", minimum: 1, maximum: 200 },
        maximumPaths: { type: "integer", minimum: 1, maximum: 500 },
        includePackages: { type: "boolean" },
        direction: {
          type: "string",
          enum: ["dependents", "dependencies"],
          description:
            "dependents = who breaks if proposed paths change (default).",
        },
        edgeTypes: {
          type: "array",
          items: {
            type: "string",
            enum: [
              "calls",
              "imports",
              "references",
              "extends",
              "implements",
              "depends_on",
              "development_depends_on",
            ],
          },
        },
      },
      required: ["proposedPaths"],
    },
    executeSupported: true,
  }),
  execute(ctx) {
    return executePlanCheckChangeImpact({
      arguments: ctx.arguments,
      repoGraphs: ctx.ports.repoGraphs,
      dirtyPaths: ctx.dirtyPaths,
      alreadyMutatedPaths: ctx.alreadyMutatedPaths,
    });
  },
};
