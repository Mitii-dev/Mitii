import type { RegisteredTool } from "../../internal/ToolRegistry";
import {
  defineTool,
  memoryGraphOpenInputSchema,
  memoryGraphOutputSchema,
  memoryGraphSearchInputSchema,
  memoryGraphUpdateInputSchema,
  memoryGraphUpdateOutputSchema,
} from "../../internal/ToolCatalog";
import {
  executeMemoryGraphOpen,
  executeMemoryGraphSearch,
  executeMemoryGraphUpdate,
} from "../ExecuteMemoryGraph";

export const memoryGraphSearchTool: RegisteredTool = {
  definition: defineTool({
    name: "memory_graph_search",
    effects: ["workspace_read"],
    description:
      "Search the workspace knowledge graph (entities/relations/observations) by substring. Distinct from MemoryFact retrieve — use for who/owns/depends questions.",
    inputSchema: memoryGraphSearchInputSchema,
    outputSchema: memoryGraphOutputSchema,
    modelInputSchema: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
    },
    executeSupported: true,
  }),
  execute(ctx) {
    return executeMemoryGraphSearch({
      arguments: ctx.arguments,
      knowledgeGraph: ctx.ports.knowledgeGraph,
    });
  },
};

export const memoryGraphOpenTool: RegisteredTool = {
  definition: defineTool({
    name: "memory_graph_open",
    effects: ["workspace_read"],
    description:
      "Open knowledge-graph entities by exact name and return incident relations.",
    inputSchema: memoryGraphOpenInputSchema,
    outputSchema: memoryGraphOutputSchema,
    modelInputSchema: {
      type: "object",
      properties: {
        names: { type: "array", items: { type: "string" } },
      },
      required: ["names"],
    },
    executeSupported: true,
  }),
  execute(ctx) {
    return executeMemoryGraphOpen({
      arguments: ctx.arguments,
      knowledgeGraph: ctx.ports.knowledgeGraph,
    });
  },
};

export const memoryGraphUpdateTool: RegisteredTool = {
  definition: defineTool({
    name: "memory_graph_update",
    effects: ["workspace_write"],
    description:
      "Mutate the knowledge graph: create_entities, create_relations, add_observations, delete_entities, delete_relations. Honest delete reporting for missing entities.",
    inputSchema: memoryGraphUpdateInputSchema,
    outputSchema: memoryGraphUpdateOutputSchema,
    modelInputSchema: {
      type: "object",
      properties: {
        operation: {
          type: "string",
          enum: [
            "create_entities",
            "create_relations",
            "add_observations",
            "delete_entities",
            "delete_relations",
          ],
        },
        entities: { type: "array" },
        relations: { type: "array" },
        observations: { type: "array" },
        names: { type: "array", items: { type: "string" } },
      },
      required: ["operation"],
    },
    executeSupported: true,
  }),
  execute(ctx) {
    return executeMemoryGraphUpdate({
      arguments: ctx.arguments,
      knowledgeGraph: ctx.ports.knowledgeGraph,
    });
  },
};
