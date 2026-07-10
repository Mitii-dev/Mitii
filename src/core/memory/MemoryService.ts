import type { ThunderDb } from '../indexing/ThunderDb';
import { sanitizeFtsQuery } from '../indexing/FtsIndex';
import { cosineSimilarity, type EmbeddingProvider } from '../indexing/EmbeddingProvider';
import { createLogger } from '../telemetry/Logger';

const log = createLogger('MemoryService');

export type ObservationType =
  | 'decision' | 'bugfix' | 'refactor' | 'architecture'
  | 'user_preference' | 'failed_attempt' | 'file_fact' | 'command_result';

export interface Observation {
  id: number;
  workspace: string;
  sessionId: string;
  type: ObservationType;
  text: string;
  files?: string[];
  concepts?: string[];
  createdAt: number;
}

export interface MemorySearchOptions {
  hybridSearchEnabled?: boolean;
  maxItems?: number;
}

const SECRET_PATTERNS = [
  /sk-[a-zA-Z0-9]{10,}/,
  /Bearer\s+[a-zA-Z0-9._-]+/i,
  /api[_-]?key/i,
];

export class MemoryService {
  private embedder: EmbeddingProvider | undefined;

  constructor(
    private readonly db: ThunderDb,
    private readonly workspace: string,
    private readonly options: MemorySearchOptions = {}
  ) {}

  setEmbedder(embedder: EmbeddingProvider | undefined): void {
    this.embedder = embedder;
  }

  write(
    sessionId: string,
    type: ObservationType,
    text: string,
    files?: string[],
    concepts?: string[]
  ): Observation | null {
    const filtered = filterSecrets(text);
    if (!filtered) {
      log.warn('Blocked memory write containing secrets');
      return null;
    }

    const result = this.db.raw.prepare(`
      INSERT INTO observations (workspace, session_id, type, text, files_json, concepts_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      this.workspace, sessionId, type, filtered,
      files ? JSON.stringify(files) : null,
      concepts ? JSON.stringify(concepts) : null,
      Date.now()
    );

    const observation: Observation = {
      id: Number(result.lastInsertRowid),
      workspace: this.workspace,
      sessionId,
      type,
      text: filtered,
      files,
      concepts,
      createdAt: Date.now(),
    };

    this.enforceMaxItems();
    void this.indexObservationEmbedding(observation);

    return observation;
  }

  search(query: string, limit = 10): Observation[] {
    const ftsResults = this.ftsSearch(query, limit);
    if (ftsResults.length > 0) return ftsResults;
    return this.keywordSearch(query, limit);
  }

  recent(limit = 10): Observation[] {
    const rows = this.db.raw
      .prepare('SELECT * FROM observations WHERE workspace = ? ORDER BY created_at DESC LIMIT ?')
      .all(this.workspace, limit) as Array<Record<string, unknown>>;
    return rows.map(rowToObservation);
  }

  delete(id: number): boolean {
    const result = this.db.raw.prepare('DELETE FROM observations WHERE id = ?').run(id);
    return result.changes > 0;
  }

  clear(): number {
    const result = this.db.raw.prepare('DELETE FROM observations WHERE workspace = ?').run(this.workspace);
    return result.changes;
  }

  private ftsSearch(query: string, limit: number): Observation[] {
    const sanitized = sanitizeFtsQuery(query);
    if (!sanitized) return [];

    try {
      const rows = this.db.raw.prepare(`
        SELECT o.*, rank
        FROM fts_observations
        JOIN observations o ON o.id = fts_observations.rowid
        WHERE fts_observations MATCH ? AND o.workspace = ?
        ORDER BY rank
        LIMIT ?
      `).all(sanitized, this.workspace, limit) as Array<Record<string, unknown>>;

      return rows.map(rowToObservation);
    } catch (error) {
      log.warn('Observation FTS search failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  private keywordSearch(query: string, limit: number): Observation[] {
    const terms = query.toLowerCase().split(/\W+/).filter((t) => t.length > 2);
    if (terms.length === 0) return this.recent(limit);

    const rows = this.db.raw
      .prepare('SELECT * FROM observations WHERE workspace = ? ORDER BY created_at DESC LIMIT 100')
      .all(this.workspace) as Array<Record<string, unknown>>;

    return rows
      .map(rowToObservation)
      .filter((obs) => terms.some((t) => obs.text.toLowerCase().includes(t)))
      .slice(0, limit);
  }

  async searchAsync(query: string, limit = 10): Promise<Observation[]> {
    const hybrid = this.options.hybridSearchEnabled !== false;
    if (!hybrid) {
      return this.keywordSearch(query, limit);
    }

    const ftsResults = this.ftsSearch(query, limit * 2);
    let vectorResults: Observation[] = [];
    if (this.embedder && this.embedder.id !== 'noop') {
      vectorResults = await this.vectorSearchAsync(query, limit * 2);
    }

    const merged = reciprocalRankFusion([ftsResults, vectorResults], limit);
    if (merged.length > 0) return merged;
    return this.keywordSearch(query, limit);
  }

  private async vectorSearchAsync(query: string, limit: number): Promise<Observation[]> {
    if (!this.embedder) return [];

    const [queryEmbedding] = await this.embedder.embed([query]);
    if (!queryEmbedding?.length) return [];

    const rows = this.db.raw.prepare(`
      SELECT o.*, oe.embedding_json
      FROM observation_embeddings oe
      JOIN observations o ON o.id = oe.observation_id
      WHERE oe.workspace = ?
      ORDER BY o.created_at DESC
      LIMIT 200
    `).all(this.workspace) as Array<Record<string, unknown> & { embedding_json: string }>;

    return rows
      .map((row) => {
        const embedding = JSON.parse(row.embedding_json) as number[];
        return {
          obs: rowToObservation(row),
          score: cosineSimilarity(queryEmbedding, embedding),
        };
      })
      .filter((r) => r.score > 0.1)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((r) => r.obs);
  }

  private async indexObservationEmbedding(observation: Observation): Promise<void> {
    if (!this.embedder || this.embedder.id === 'noop') return;

    try {
      const text = [observation.type, observation.text, ...(observation.concepts ?? [])].join(' ');
      const [embedding] = await this.embedder.embed([text.slice(0, 1500)]);
      if (!embedding.length) return;

      this.db.raw.prepare(`
        INSERT INTO observation_embeddings (observation_id, workspace, embedding_json, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(observation_id) DO UPDATE SET
          embedding_json = excluded.embedding_json,
          updated_at = excluded.updated_at
      `).run(observation.id, this.workspace, JSON.stringify(embedding), Date.now());
    } catch (error) {
      log.warn('Observation embedding failed', {
        id: observation.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private enforceMaxItems(): void {
    const maxItems = this.options.maxItems;
    if (!maxItems || maxItems <= 0) return;

    const row = this.db.raw
      .prepare('SELECT COUNT(*) as cnt FROM observations WHERE workspace = ?')
      .get(this.workspace) as { cnt: number };

    const excess = row.cnt - maxItems;
    if (excess <= 0) return;

    this.db.raw.prepare(`
      DELETE FROM observations
      WHERE id IN (
        SELECT id FROM observations
        WHERE workspace = ?
        ORDER BY created_at ASC
        LIMIT ?
      )
    `).run(this.workspace, excess);
  }
}

function reciprocalRankFusion(lists: Observation[][], limit: number): Observation[] {
  const scores = new Map<number, { obs: Observation; score: number }>();
  const k = 60;

  for (const list of lists) {
    list.forEach((obs, rank) => {
      const existing = scores.get(obs.id);
      const rrf = 1 / (k + rank + 1);
      if (existing) {
        existing.score += rrf;
      } else {
        scores.set(obs.id, { obs, score: rrf });
      }
    });
  }

  return Array.from(scores.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((e) => e.obs);
}

export function filterSecrets(text: string): string | null {
  for (const pattern of SECRET_PATTERNS) {
    if (pattern.test(text)) return null;
  }
  return text;
}

function rowToObservation(row: Record<string, unknown>): Observation {
  return {
    id: row.id as number,
    workspace: row.workspace as string,
    sessionId: row.session_id as string,
    type: row.type as ObservationType,
    text: row.text as string,
    files: row.files_json ? JSON.parse(row.files_json as string) : undefined,
    concepts: row.concepts_json ? JSON.parse(row.concepts_json as string) : undefined,
    createdAt: row.created_at as number,
  };
}
