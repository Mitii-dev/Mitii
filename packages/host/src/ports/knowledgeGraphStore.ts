import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import {
  KnowledgeGraphManager,
  knowledgeGraphEntitySchema,
  knowledgeGraphRelationSchema,
  knowledgeGraphSchema,
  type KnowledgeGraph,
  type KnowledgeGraphStorePort,
} from '@mitii/v8';

const GRAPH_FILE_NAME = 'graph.jsonl';

/**
 * Durable knowledge-graph store under `<workspace>/.mitii/memory/graph.jsonl`.
 * JSONL typed lines + atomic temp+rename (servers-main memory persistence).
 */
export class FileWorkspaceKnowledgeGraphStore
  implements KnowledgeGraphStorePort
{
  private readonly filePath: string;

  constructor(workspaceRoot: string) {
    this.filePath = join(
      workspaceRoot,
      '.mitii',
      'memory',
      GRAPH_FILE_NAME,
    );
  }

  public async load(): Promise<KnowledgeGraph> {
    let raw: string;
    try {
      raw = await readFile(this.filePath, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return { entities: [], relations: [] };
      }
      throw error;
    }

    const graph: KnowledgeGraph = { entities: [], relations: [] };
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let item: unknown;
      try {
        item = JSON.parse(trimmed);
      } catch {
        continue;
      }
      if (!item || typeof item !== 'object') continue;
      const record = item as Record<string, unknown>;
      if (record.type === 'entity') {
        const parsed = knowledgeGraphEntitySchema.safeParse({
          name: record.name,
          entityType: record.entityType,
          observations: record.observations ?? [],
        });
        if (parsed.success) graph.entities.push(parsed.data);
      } else if (record.type === 'relation') {
        const parsed = knowledgeGraphRelationSchema.safeParse({
          from: record.from,
          to: record.to,
          relationType: record.relationType,
        });
        if (parsed.success) graph.relations.push(parsed.data);
      }
    }
    return knowledgeGraphSchema.parse(graph);
  }

  public async save(graph: KnowledgeGraph): Promise<void> {
    const validated = knowledgeGraphSchema.parse(graph);
    const lines = [
      ...validated.entities.map((entity) =>
        JSON.stringify({
          type: 'entity',
          name: entity.name,
          entityType: entity.entityType,
          observations: entity.observations,
        }),
      ),
      ...validated.relations.map((relation) =>
        JSON.stringify({
          type: 'relation',
          from: relation.from,
          to: relation.to,
          relationType: relation.relationType,
        }),
      ),
    ];
    await mkdir(dirname(this.filePath), { recursive: true });
    const tempPath = `${this.filePath}.${process.pid}.${randomBytes(8).toString('hex')}.tmp`;
    try {
      await writeFile(
        tempPath,
        lines.length > 0 ? `${lines.join('\n')}\n` : '',
        'utf8',
      );
      await rename(tempPath, this.filePath);
    } catch (error) {
      await unlink(tempPath).catch(() => undefined);
      throw error;
    }
  }
}

export function createWorkspaceKnowledgeGraph(
  workspaceRoot: string,
): KnowledgeGraphManager {
  return new KnowledgeGraphManager(
    new FileWorkspaceKnowledgeGraphStore(workspaceRoot),
  );
}
