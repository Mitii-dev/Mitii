import { z } from "zod";

export const knowledgeGraphEntitySchema = z
  .object({
    name: z.string().min(1).max(512),
    entityType: z.string().min(1).max(128),
    observations: z.array(z.string().min(1).max(8_000)).max(500).default([]),
  })
  .strict();

export type KnowledgeGraphEntity = z.infer<typeof knowledgeGraphEntitySchema>;

export const knowledgeGraphRelationSchema = z
  .object({
    from: z.string().min(1).max(512),
    to: z.string().min(1).max(512),
    relationType: z.string().min(1).max(128),
  })
  .strict();

export type KnowledgeGraphRelation = z.infer<
  typeof knowledgeGraphRelationSchema
>;

export const knowledgeGraphSchema = z
  .object({
    entities: z.array(knowledgeGraphEntitySchema),
    relations: z.array(knowledgeGraphRelationSchema),
  })
  .strict();

export type KnowledgeGraph = z.infer<typeof knowledgeGraphSchema>;

export interface KnowledgeGraphDeleteEntitiesResult {
  deleted: string[];
  notFound: string[];
}

export interface KnowledgeGraphAddObservationsResult {
  entityName: string;
  addedObservations: string[];
}

/**
 * Durable relational memory beside MemoryFact store.
 * Hosts inject a concrete adapter; V8 never touches the filesystem.
 */
export interface KnowledgeGraphPort {
  read(): Promise<KnowledgeGraph> | KnowledgeGraph;

  search(query: string): Promise<KnowledgeGraph> | KnowledgeGraph;

  open(names: readonly string[]): Promise<KnowledgeGraph> | KnowledgeGraph;

  createEntities(
    entities: readonly KnowledgeGraphEntity[],
  ):
    | Promise<readonly KnowledgeGraphEntity[]>
    | readonly KnowledgeGraphEntity[];

  createRelations(
    relations: readonly KnowledgeGraphRelation[],
  ):
    | Promise<readonly KnowledgeGraphRelation[]>
    | readonly KnowledgeGraphRelation[];

  addObservations(
    observations: readonly {
      entityName: string;
      contents: readonly string[];
    }[],
  ):
    | Promise<readonly KnowledgeGraphAddObservationsResult[]>
    | readonly KnowledgeGraphAddObservationsResult[];

  deleteEntities(
    names: readonly string[],
  ):
    | Promise<KnowledgeGraphDeleteEntitiesResult>
    | KnowledgeGraphDeleteEntitiesResult;

  deleteRelations(
    relations: readonly KnowledgeGraphRelation[],
  ): Promise<{ deletedCount: number }> | { deletedCount: number };
}

/** Persistence backend for KnowledgeGraphManager. */
export interface KnowledgeGraphStorePort {
  load(): Promise<KnowledgeGraph> | KnowledgeGraph;
  save(graph: KnowledgeGraph): Promise<void> | void;
}
