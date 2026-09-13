import {
  knowledgeGraphSchema,
  type KnowledgeGraph,
  type KnowledgeGraphStorePort,
} from "./contracts";

/**
 * In-process graph store for tests and single-process hosts.
 */
export class InMemoryKnowledgeGraphStore implements KnowledgeGraphStorePort {
  private graph: KnowledgeGraph = { entities: [], relations: [] };

  constructor(seed?: KnowledgeGraph) {
    if (seed) {
      this.graph = knowledgeGraphSchema.parse(seed);
    }
  }

  public load(): KnowledgeGraph {
    return {
      entities: this.graph.entities.map((e) => ({
        ...e,
        observations: [...e.observations],
      })),
      relations: this.graph.relations.map((r) => ({ ...r })),
    };
  }

  public save(graph: KnowledgeGraph): void {
    this.graph = knowledgeGraphSchema.parse(graph);
  }
}
