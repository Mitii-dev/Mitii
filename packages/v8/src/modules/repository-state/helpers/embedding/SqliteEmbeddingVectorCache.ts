import type {
  SqliteDatabasePort,
} from "../shared/sqlite";
import type {
  EmbeddingVectorCachePort,
} from "./types";

const CREATE_CACHE_TABLE = `
  CREATE TABLE IF NOT EXISTS embedding_vector_cache (
    profile_id TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    dimensions INTEGER NOT NULL,
    vector_json TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (profile_id, content_hash)
  );
`;

interface CacheRow {
  vectorJson: string;
  dimensions: number;
}

/**
 * SQLite-backed embedding cache. Cache failures must never abort embedding
 * synchronization — LanceDB is the source of truth for vectors.
 */
export class SqliteEmbeddingVectorCache
  implements EmbeddingVectorCachePort
{
  private ready = false;
  private disabled = false;
  private readonly memory = new Map<string, readonly number[]>();

  constructor(
    private readonly database: SqliteDatabasePort,
  ) {}

  public get(
    profileId: string,
    contentHash: string,
  ): readonly number[] | undefined {
    const memoryKey = cacheKey(profileId, contentHash);
    const mem = this.memory.get(memoryKey);
    if (mem) return mem;

    if (this.disabled) {
      return undefined;
    }

    try {
      this.ensureSchema();
      if (this.disabled) return undefined;

      const row = this.database
        .prepare(
          `
          SELECT
            vector_json AS vectorJson,
            dimensions AS dimensions
          FROM embedding_vector_cache
          WHERE profile_id = ?
            AND content_hash = ?
          LIMIT 1
        `,
        )
        .get(profileId, contentHash) as CacheRow | undefined;

      if (!row) {
        return undefined;
      }

      const parsed = JSON.parse(row.vectorJson) as unknown;
      if (
        !Array.isArray(parsed) ||
        parsed.length !== row.dimensions ||
        parsed.some((value) => typeof value !== "number" || !Number.isFinite(value))
      ) {
        return undefined;
      }

      return parsed;
    } catch {
      this.disabled = true;
      return undefined;
    }
  }

  public set(
    profileId: string,
    contentHash: string,
    vector: readonly number[],
  ): void {
    const memoryKey = cacheKey(profileId, contentHash);
    this.memory.set(memoryKey, vector);

    if (this.disabled) {
      return;
    }

    try {
      this.ensureSchema();
      if (this.disabled) return;

      this.database
        .prepare(
          `
          INSERT INTO embedding_vector_cache (
            profile_id,
            content_hash,
            dimensions,
            vector_json,
            updated_at
          )
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT (profile_id, content_hash)
          DO UPDATE SET
            dimensions = excluded.dimensions,
            vector_json = excluded.vector_json,
            updated_at = excluded.updated_at
        `,
        )
        .run(
          profileId,
          contentHash,
          vector.length,
          JSON.stringify(vector),
          Date.now(),
        );
    } catch {
      // Keep process-local memory cache; continue embedding without SQLite.
      this.disabled = true;
    }
  }

  private ensureSchema(): void {
    if (this.ready || this.disabled) {
      return;
    }

    try {
      this.database.exec(CREATE_CACHE_TABLE);
      this.ready = true;
    } catch {
      this.disabled = true;
    }
  }
}

function cacheKey(profileId: string, contentHash: string): string {
  return `${profileId}\0${contentHash}`;
}
