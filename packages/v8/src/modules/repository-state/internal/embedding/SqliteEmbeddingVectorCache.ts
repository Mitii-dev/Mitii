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

export class SqliteEmbeddingVectorCache
  implements EmbeddingVectorCachePort
{
  private ready = false;

  constructor(
    private readonly database: SqliteDatabasePort,
  ) {}

  public get(
    profileId: string,
    contentHash: string,
  ): readonly number[] | undefined {
    this.ensureSchema();

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

    try {
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
      return undefined;
    }
  }

  public set(
    profileId: string,
    contentHash: string,
    vector: readonly number[],
  ): void {
    this.ensureSchema();

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
  }

  private ensureSchema(): void {
    if (this.ready) {
      return;
    }

    this.database.exec(CREATE_CACHE_TABLE);
    this.ready = true;
  }
}
