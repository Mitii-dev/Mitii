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
      "Estimate what depends on a file or symbol, or what that file depends on. Default direction is dependents (who breaks if this changes). Set direction=dependencies for hop-bounded imports. Walks callers, importers, references, and package edges in the repository graph. Respect truncation and reasonCodes.",
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
        direction: {
          type: "string",
          enum: ["dependents", "dependencies"],
          description:
            "dependents = who breaks if this changes (default). dependencies = what this file imports / depends on.",
        },
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
