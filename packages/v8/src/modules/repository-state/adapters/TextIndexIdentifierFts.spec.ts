import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';

import { ChunkingFactory } from '../internal/chunking/ChunkingFactory';
import { NodeSha256ChunkHasher } from '../internal/chunking/adapters/node/NodeSha256ChunkHasher';
import { SqliteTextIndexFactory } from '../internal/text-index/adapters/sqlite/SqliteTextIndexFactory';
import { SqliteTextIndexMigration } from '../internal/text-index/adapters/sqlite/SqliteTextIndexMigration';
import { TEXT_INDEX_SCHEMA_VERSION } from '../internal/text-index/constants';
import type {
  SqliteDatabasePort,
  SqliteStatementPort,
} from '../internal/shared/sqlite';

class BetterSqliteDatabasePort implements SqliteDatabasePort {
  constructor(private readonly database: Database.Database) {}

  public prepare(sql: string): SqliteStatementPort {
    return this.database.prepare(sql) as unknown as SqliteStatementPort;
  }

  public exec(sql: string): void {
    this.database.exec(sql);
  }

  public transaction<T>(operation: () => T): T {
    return this.database.transaction(operation)();
  }
}

async function createTextIndex() {
  const database = new Database(':memory:');
  const port = new BetterSqliteDatabasePort(database);
  await new SqliteTextIndexMigration().migrate(port);

  return {
    database,
    port,
    textIndex: new SqliteTextIndexFactory().create(port),
    chunker: new ChunkingFactory().create({
      hasher: new NodeSha256ChunkHasher(),
    }),
  };
}

describe('identifier-aware text index FTS', () => {
  it('matches camelCase queries against snake_case and PascalCase identifiers', async () => {
    const fixture = await createTextIndex();

    try {
      for (const [relativePath, content] of [
        [
          'src/snake.ts',
          'export function validate_jwt(token: string) { return true; }',
        ],
        [
          'src/pascal.ts',
          'export function ValidateJwt(token: string) { return true; }',
        ],
      ] as const) {
        const chunking = await fixture.chunker.chunk({
          sourceId: `source:${relativePath}`,
          rootId: 'workspace',
          relativePath,
          language: 'typescript',
          content,
        });

        await fixture.textIndex.coordinator.index({
          workspace: '/repo',
          workspaceSnapshotId: 'snapshot-1',
          indexedAt: 100,
          chunking,
        });
      }

      const result = await fixture.textIndex.search.search({
        workspace: '/repo',
        query: 'validateJwt',
        maximumResults: 10,
      });

      expect(result.matches.map((match) => match.relativePath).sort()).toEqual([
        'src/pascal.ts',
        'src/snake.ts',
      ]);
    } finally {
      fixture.database.close();
    }
  });

  it('bumps old text-index metadata revisions during identifier FTS migration', async () => {
    const fixture = await createTextIndex();

    try {
      fixture.database
        .prepare(
          `
            INSERT INTO text_index_metadata (
              workspace,
              root_id,
              schema_version,
              revision,
              snapshot_id,
              updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?)
          `,
        )
        .run('/repo', 'workspace', 1, 5, 'snapshot-old', 100);

      await new SqliteTextIndexMigration().migrate(fixture.port);

      const row = fixture.database
        .prepare(
          `
            SELECT schema_version AS schemaVersion, revision AS revision
            FROM text_index_metadata
            WHERE workspace = ? AND root_id = ?
          `,
        )
        .get('/repo', 'workspace') as {
        schemaVersion: number;
        revision: number;
      };

      expect(row).toEqual({
        schemaVersion: TEXT_INDEX_SCHEMA_VERSION,
        revision: 6,
      });
    } finally {
      fixture.database.close();
    }
  });
});
