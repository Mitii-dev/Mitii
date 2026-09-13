import type { KnowledgeGraphPort } from "../../../modules/memory";
import { ToolRuntimeError } from "../contracts";
import {
  memoryGraphOpenInputSchema,
  memoryGraphOutputSchema,
  memoryGraphSearchInputSchema,
  memoryGraphUpdateInputSchema,
  memoryGraphUpdateOutputSchema,
} from "../internal/ToolCatalog";
import { GrantValidationError } from "./ValidateGrant";

function requireGraph(graph?: KnowledgeGraphPort): KnowledgeGraphPort {
  if (!graph) {
    throw new ToolRuntimeError(
      "misconfigured_ports",
      "KnowledgeGraphPort is required for memory_graph tools.",
    );
  }
  return graph;
}

export async function executeMemoryGraphSearch(params: {
  arguments: unknown;
  knowledgeGraph?: KnowledgeGraphPort;
}): Promise<{ output: unknown; truncated: boolean; redacted: boolean }> {
  const input = memoryGraphSearchInputSchema.parse(params.arguments);
  const graph = requireGraph(params.knowledgeGraph);
  const result = await graph.search(input.query);
  return {
    output: memoryGraphOutputSchema.parse(result),
    truncated: false,
    redacted: false,
  };
}

export async function executeMemoryGraphOpen(params: {
  arguments: unknown;
  knowledgeGraph?: KnowledgeGraphPort;
}): Promise<{ output: unknown; truncated: boolean; redacted: boolean }> {
  const input = memoryGraphOpenInputSchema.parse(params.arguments);
  const graph = requireGraph(params.knowledgeGraph);
  const result = await graph.open(input.names);
  return {
    output: memoryGraphOutputSchema.parse(result),
    truncated: false,
    redacted: false,
  };
}

export async function executeMemoryGraphUpdate(params: {
  arguments: unknown;
  knowledgeGraph?: KnowledgeGraphPort;
}): Promise<{ output: unknown; truncated: boolean; redacted: boolean }> {
  const input = memoryGraphUpdateInputSchema.parse(params.arguments);
  const graph = requireGraph(params.knowledgeGraph);

  try {
    let result: unknown;
    let message: string;
    switch (input.operation) {
      case "create_entities": {
        if (!input.entities?.length) {
          throw new GrantValidationError(
            "invalid_arguments",
            "create_entities requires entities[].",
          );
        }
        result = await graph.createEntities(input.entities);
        message = `Created ${(result as unknown[]).length} entit(y/ies).`;
        break;
      }
      case "create_relations": {
        if (!input.relations?.length) {
          throw new GrantValidationError(
            "invalid_arguments",
            "create_relations requires relations[].",
          );
        }
        result = await graph.createRelations(input.relations);
        message = `Created ${(result as unknown[]).length} relation(s).`;
        break;
      }
      case "add_observations": {
        if (!input.observations?.length) {
          throw new GrantValidationError(
            "invalid_arguments",
            "add_observations requires observations[].",
          );
        }
        result = await graph.addObservations(input.observations);
        message = "Added observations.";
        break;
      }
      case "delete_entities": {
        if (!input.names?.length) {
          throw new GrantValidationError(
            "invalid_arguments",
            "delete_entities requires names[].",
          );
        }
        result = await graph.deleteEntities(input.names);
        const deleted = (result as { deleted: string[] }).deleted.length;
        const notFound = (result as { notFound: string[] }).notFound.length;
        message = `Deleted ${deleted} entit(y/ies); ${notFound} not found.`;
        break;
      }
      case "delete_relations": {
        if (!input.relations?.length) {
          throw new GrantValidationError(
            "invalid_arguments",
            "delete_relations requires relations[].",
          );
        }
        result = await graph.deleteRelations(input.relations);
        message = `Deleted ${(result as { deletedCount: number }).deletedCount} relation(s).`;
        break;
      }
      default:
        throw new GrantValidationError(
          "invalid_arguments",
          `Unknown operation: ${String(input.operation)}`,
        );
    }

    return {
      output: memoryGraphUpdateOutputSchema.parse({
        operation: input.operation,
        result,
        message,
      }),
      truncated: false,
      redacted: false,
    };
  } catch (error) {
    if (error instanceof GrantValidationError) {
      throw error;
    }
    if (error instanceof Error) {
      throw new GrantValidationError("invalid_arguments", error.message);
    }
    throw error;
  }
}
