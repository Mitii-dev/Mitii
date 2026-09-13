import {
  knowledgeGraphEntitySchema,
  knowledgeGraphRelationSchema,
  knowledgeGraphSchema,
  type KnowledgeGraph,
  type KnowledgeGraphAddObservationsResult,
  type KnowledgeGraphDeleteEntitiesResult,
  type KnowledgeGraphEntity,
  type KnowledgeGraphPort,
  type KnowledgeGraphRelation,
  type KnowledgeGraphStorePort,
} from "./contracts";

/**
 * Serializes RMW so concurrent graph tool calls cannot last-write-wins.
 */
class MutationQueue {
  private chain: Promise<unknown> = Promise.resolve();

  public enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.chain.then(operation, operation);
    this.chain = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

/**
 * Knowledge-graph operations over an injected store (servers-main memory technique).
 * Pure domain — hosts own JSONL / Memento persistence.
 */
export class KnowledgeGraphManager implements KnowledgeGraphPort {
  private readonly mutations = new MutationQueue();

  constructor(private readonly store: KnowledgeGraphStorePort) {}

  public async read(): Promise<KnowledgeGraph> {
    return this.loadValidated();
  }

  public async search(query: string): Promise<KnowledgeGraph> {
    const needle = query.trim().toLowerCase();
    const graph = await this.loadValidated();
    if (!needle) {
      return { entities: [], relations: [] };
    }
    const entities = graph.entities.filter(
      (entity) =>
        entity.name.toLowerCase().includes(needle) ||
        entity.entityType.toLowerCase().includes(needle) ||
        entity.observations.some((o) => o.toLowerCase().includes(needle)),
    );
    return {
      entities,
      relations: filterIncidentRelations(graph.relations, entities),
    };
  }

  public async open(names: readonly string[]): Promise<KnowledgeGraph> {
    const wanted = new Set(names);
    const graph = await this.loadValidated();
    const entities = graph.entities.filter((entity) => wanted.has(entity.name));
    return {
      entities,
      relations: filterIncidentRelations(graph.relations, entities),
    };
  }

  public async createEntities(
    entities: readonly KnowledgeGraphEntity[],
  ): Promise<readonly KnowledgeGraphEntity[]> {
    return this.mutations.enqueue(async () => {
      const graph = await this.loadValidated();
      const parsed = entities.map((e) => knowledgeGraphEntitySchema.parse(e));
      const created: KnowledgeGraphEntity[] = [];
      for (let i = 0; i < parsed.length; i += 1) {
        const entity = parsed[i]!;
        const duplicateInGraph = graph.entities.some((e) => e.name === entity.name);
        const duplicateInBatch = parsed
          .slice(0, i)
          .some((e) => e.name === entity.name);
        if (duplicateInGraph || duplicateInBatch) {
          continue;
        }
        graph.entities.push(entity);
        created.push(entity);
      }
      await this.store.save(graph);
      return created;
    });
  }

  public async createRelations(
    relations: readonly KnowledgeGraphRelation[],
  ): Promise<readonly KnowledgeGraphRelation[]> {
    return this.mutations.enqueue(async () => {
      const graph = await this.loadValidated();
      const names = new Set(graph.entities.map((e) => e.name));
      const parsed = relations.map((r) => knowledgeGraphRelationSchema.parse(r));
      for (const relation of parsed) {
        if (!names.has(relation.from)) {
          throw new Error(`Entity "${relation.from}" not found.`);
        }
        if (!names.has(relation.to)) {
          throw new Error(`Entity "${relation.to}" not found.`);
        }
      }
      const created: KnowledgeGraphRelation[] = [];
      for (let i = 0; i < parsed.length; i += 1) {
        const relation = parsed[i]!;
        const duplicateInGraph = graph.relations.some((r) =>
          sameRelation(r, relation),
        );
        const duplicateInBatch = parsed
          .slice(0, i)
          .some((r) => sameRelation(r, relation));
        if (duplicateInGraph || duplicateInBatch) {
          continue;
        }
        graph.relations.push(relation);
        created.push(relation);
      }
      await this.store.save(graph);
      return created;
    });
  }

  public async addObservations(
    observations: readonly {
      entityName: string;
      contents: readonly string[];
    }[],
  ): Promise<readonly KnowledgeGraphAddObservationsResult[]> {
    return this.mutations.enqueue(async () => {
      const graph = await this.loadValidated();
      const results: KnowledgeGraphAddObservationsResult[] = [];
      for (const item of observations) {
        const entity = graph.entities.find((e) => e.name === item.entityName);
        if (!entity) {
          throw new Error(`Entity "${item.entityName}" not found.`);
        }
        const added = item.contents.filter(
          (content) => !entity.observations.includes(content),
        );
        entity.observations.push(...added);
        results.push({
          entityName: item.entityName,
          addedObservations: [...added],
        });
      }
      await this.store.save(graph);
      return results;
    });
  }

  public async deleteEntities(
    names: readonly string[],
  ): Promise<KnowledgeGraphDeleteEntitiesResult> {
    return this.mutations.enqueue(async () => {
      const graph = await this.loadValidated();
      const present = new Set(graph.entities.map((e) => e.name));
      const deleted = names.filter((name) => present.has(name));
      const notFound = names.filter((name) => !present.has(name));
      const remove = new Set(names);
      graph.entities = graph.entities.filter((e) => !remove.has(e.name));
      graph.relations = graph.relations.filter(
        (r) => !remove.has(r.from) && !remove.has(r.to),
      );
      await this.store.save(graph);
      return { deleted: [...deleted], notFound: [...notFound] };
    });
  }

  public async deleteRelations(
    relations: readonly KnowledgeGraphRelation[],
  ): Promise<{ deletedCount: number }> {
    return this.mutations.enqueue(async () => {
      const graph = await this.loadValidated();
      const before = graph.relations.length;
      const parsed = relations.map((r) => knowledgeGraphRelationSchema.parse(r));
      graph.relations = graph.relations.filter(
        (r) => !parsed.some((del) => sameRelation(r, del)),
      );
      await this.store.save(graph);
      return { deletedCount: before - graph.relations.length };
    });
  }

  private async loadValidated(): Promise<KnowledgeGraph> {
    const raw = await this.store.load();
    return knowledgeGraphSchema.parse(raw);
  }
}

function sameRelation(
  a: KnowledgeGraphRelation,
  b: KnowledgeGraphRelation,
): boolean {
  return (
    a.from === b.from &&
    a.to === b.to &&
    a.relationType === b.relationType
  );
}

function filterIncidentRelations(
  relations: readonly KnowledgeGraphRelation[],
  entities: readonly KnowledgeGraphEntity[],
): KnowledgeGraphRelation[] {
  const names = new Set(entities.map((e) => e.name));
  return relations.filter((r) => names.has(r.from) || names.has(r.to));
}
