import type { RegisteredTool } from "../../internal/ToolRegistry";
import {
  analyzeChangeImpactInputSchema,
  analyzeChangeImpactOutputSchema,
  defineTool,
} from "../../internal/ToolCatalog";
import { executeAnalyzeChangeImpact } from "../ExecuteAnalyzeChangeImpact";

export const analyzeChangeImpactTool: RegisteredTool = {
  definition: defineTool({
    name: "analyze_change_impact",
    effects: ["workspace_read"],
    description:
      "Estimate what depends on a file or symbol if it changes. Walks callers, importers, references, and package dependents in the repository graph. Use for blast-radius and 'what breaks if I change X' questions; respect truncation and reasonCodes.",
    inputSchema: analyzeChangeImpactInputSchema,
    outputSchema: analyzeChangeImpactOutputSchema,
    modelInputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Workspace-relative file path of the change seed.",
        },
        line: {
          type: "integer",
          minimum: 1,
          description: "1-based line for a caret/symbol seed.",
        },
        column: {
          type: "integer",
          minimum: 1,
          description: "1-based column for a caret/symbol seed.",
        },
        symbolName: {
          type: "string",
          description: "Optional symbol name to disambiguate the seed.",
        },
        maximumHops: { type: "integer", minimum: 1, maximum: 6 },
        maximumAffectedNodes: { type: "integer", minimum: 1, maximum: 200 },
        includePackages: { type: "boolean" },
        edgeTypes: {
          type: "array",
          items: {
            type: "string",
            enum: [
              "calls",
              "imports",
              "references",
              "depends_on",
              "development_depends_on",
            ],
          },
        },
      },
      required: ["path"],
    },
    executeSupported: true,
  }),
  execute(ctx) {
    return executeAnalyzeChangeImpact({
      arguments: ctx.arguments,
      repoGraphs: ctx.ports.repoGraphs,
      dirtyPaths: ctx.dirtyPaths,
      alreadyMutatedPaths: ctx.alreadyMutatedPaths,
    });
  },
};
