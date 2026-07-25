import assert from "node:assert/strict";
import test from "node:test";

import Database from "better-sqlite3";

import {
  ChunkingFactory,
  NodeSha256ChunkHasher,
} from "../../chunking";

import type {
  SqliteDatabasePort,
  SqliteStatementPort,
} from "../../shared/sqlite";

import {
  SqliteTextIndexFactory,
  SqliteTextIndexMigration,
} from "../index";

class BetterSqliteDatabasePort
  implements SqliteDatabasePort
{
  constructor(
    private readonly database:
      Database.Database,
  ) {}

  public prepare(
    sql: string,
  ): SqliteStatementPort {
    return this.database
      .prepare(sql) as unknown as
      SqliteStatementPort;
  }

  public exec(sql: string): void {
    this.database.exec(sql);
  }

  public transaction<T>(
    operation: () => T,
  ): T {
    return this.database
      .transaction(operation)();
  }
}

async function createFixture() {
  const database =
    new Database(":memory:");

  const port =
    new BetterSqliteDatabasePort(
      database,
    );

  await new SqliteTextIndexMigration()
    .migrate(port);

  const textIndex =
    new SqliteTextIndexFactory()
      .create(port);

  const chunker =
    new ChunkingFactory().create({
      hasher:
        new NodeSha256ChunkHasher(),
    });

  return {
    database,
    textIndex,
    chunker,
  };
}

test(
  "indexes Chunking output and searches it",
  async () => {
    const fixture =
      await createFixture();

    try {
      const chunking =
        await fixture.chunker
          .chunk({
            sourceId:
              "source:auth",
            rootId:
              "workspace",
            relativePath:
              "src/auth.ts",
            language:
              "typescript",
            content: [
              "export function authenticate(token: string) {",
              "  return verifyAuthenticationToken(token);",
              "}",
            ].join("\n"),
          });

      const indexed =
        await fixture.textIndex
          .coordinator.index({
            workspace:
              "/repo",
            workspaceSnapshotId:
              "snapshot-1",
            indexedAt: 100,
            chunking,
          });

      assert.equal(
        indexed.status,
        "indexed",
      );

      const result =
        await fixture.textIndex
          .search.search({
            workspace:
              "/repo",
            query:
              "authentication token",
            rootIds: [
              "workspace",
            ],
          });

      assert.equal(
        result.status,
        "complete",
      );

      assert.equal(
        result.matches[0]
          ?.relativePath,
        "src/auth.ts",
      );

      assert.match(
        result.matches[0]
          ?.snippet ?? "",
        /\[\[authentication/i,
      );
    } finally {
      fixture.database.close();
    }
  },
);

test(
  "skips unchanged documents and refreshes metadata separately",
  async () => {
    const fixture =
      await createFixture();

    try {
      const chunking =
        await fixture.chunker
          .chunk({
            sourceId:
              "source:stable",
            rootId:
              "workspace",
            relativePath:
              "src/stable.ts",
            content:
              "export const stable = true;",
            language:
              "typescript",
          });

      const first =
        await fixture.textIndex
          .coordinator.index({
            workspace:
              "/repo",
            workspaceSnapshotId:
              "snapshot-1",
            indexedAt: 100,
            chunking,
          });

      const unchanged =
        await fixture.textIndex
          .coordinator.index({
            workspace:
              "/repo",
            workspaceSnapshotId:
              "snapshot-1",
            indexedAt: 100,
            chunking,
          });

      const refreshed =
        await fixture.textIndex
          .coordinator.index({
            workspace:
              "/repo",
            workspaceSnapshotId:
              "snapshot-2",
            indexedAt: 200,
            chunking,
          });

      assert.equal(
        first.status,
        "indexed",
      );

      assert.equal(
        unchanged.status,
        "unchanged",
      );

      assert.equal(
        refreshed.status,
        "metadata_refreshed",
      );

      assert.equal(
        await fixture.textIndex
          .reader.getRevision(
            "/repo",
            "workspace",
          ),
        1,
      );
    } finally {
      fixture.database.close();
    }
  },
);

test(
  "publishes bounded chunk changes for embedding synchronization",
  async () => {
    const fixture =
      await createFixture();

    try {
      const firstChunking =
        await fixture.chunker
          .chunk({
            sourceId:
              "source:change",
            rootId:
              "workspace",
            relativePath:
              "src/change.ts",
            content:
              "export const oldValue = 'legacy';",
            language:
              "typescript",
          });

      await fixture.textIndex
        .coordinator.index({
          workspace:
            "/repo",
          workspaceSnapshotId:
            "snapshot-1",
          indexedAt: 100,
          chunking:
            firstChunking,
        });

      const secondChunking =
        await fixture.chunker
          .chunk({
            sourceId:
              "source:change",
            rootId:
              "workspace",
            relativePath:
              "src/change.ts",
            content:
              "export const newValue = 'modern';",
            language:
              "typescript",
          });

      await fixture.textIndex
        .coordinator.index({
          workspace:
            "/repo",
          workspaceSnapshotId:
            "snapshot-2",
          indexedAt: 200,
          chunking:
            secondChunking,
        });

      const changes =
        await fixture.textIndex
          .reader.getChanges({
            workspace:
              "/repo",
            rootId:
              "workspace",
            afterRevision: 1,
            maximumChanges: 10,
          });

      assert.equal(
        changes.latestRevision,
        2,
      );

      assert.ok(
        changes.changes.some(
          (change) =>
            change.kind ===
            "delete",
        ),
      );

      const upsert =
        changes.changes.find(
          (change) =>
            change.kind ===
            "upsert",
        );

      assert.ok(upsert);

      const chunks =
        await fixture.textIndex
          .reader.getChunks({
            workspace:
              "/repo",
            chunkIds: [
              upsert.chunkId,
            ],
            maximumChunks: 10,
          });

      assert.equal(
        chunks.chunks[0]
          ?.content.includes(
            "modern",
          ),
        true,
      );
    } finally {
      fixture.database.close();
    }
  },
);

test(
  "does not overwrite valid data with rejected Chunking output",
  async () => {
    const fixture =
      await createFixture();

    try {
      const valid =
        await fixture.chunker
          .chunk({
            sourceId:
              "source:preserve",
            rootId:
              "workspace",
            relativePath:
              "src/preserve.txt",
            content:
              "preserve searchable content",
          });

      await fixture.textIndex
        .coordinator.index({
          workspace:
            "/repo",
          workspaceSnapshotId:
            "snapshot-1",
          indexedAt: 100,
          chunking: valid,
        });

      const rejected =
        await fixture.chunker
          .chunk(
            {
              sourceId:
                "source:preserve",
              rootId:
                "workspace",
              relativePath:
                "src/preserve.txt",
              content:
                "x".repeat(200),
            },
            {
              maximumInputCharacters:
                10,
              inputOverflowPolicy:
                "reject",
            },
          );

      const outcome =
        await fixture.textIndex
          .coordinator.index({
            workspace:
              "/repo",
            workspaceSnapshotId:
              "snapshot-2",
            indexedAt: 200,
            chunking: rejected,
          });

      assert.equal(
        outcome.status,
        "not_indexable",
      );

      const search =
        await fixture.textIndex
          .search.search({
            workspace:
              "/repo",
            query: "searchable",
          });

      assert.equal(
        search.matches.length,
        1,
      );
    } finally {
      fixture.database.close();
    }
  },
);

test(
  "isolates identical chunk IDs across workspaces",
  async () => {
    const fixture =
      await createFixture();

    try {
      const chunking =
        await fixture.chunker
          .chunk({
            sourceId:
              "source:shared",
            rootId:
              "workspace",
            relativePath:
              "src/shared.ts",
            content:
              "export const sharedMarker = true;",
            language:
              "typescript",
          });

      await fixture.textIndex
        .coordinator.index({
          workspace:
            "/repo-a",
          workspaceSnapshotId:
            "snapshot-a",
          indexedAt: 100,
          chunking,
        });

      await fixture.textIndex
        .coordinator.index({
          workspace:
            "/repo-b",
          workspaceSnapshotId:
            "snapshot-b",
          indexedAt: 100,
          chunking,
        });

      const first =
        await fixture.textIndex
          .search.search({
            workspace:
              "/repo-a",
            query:
              "sharedMarker",
          });

      const second =
        await fixture.textIndex
          .search.search({
            workspace:
              "/repo-b",
            query:
              "sharedMarker",
          });

      assert.equal(
        first.matches.length,
        1,
      );

      assert.equal(
        second.matches.length,
        1,
      );
    } finally {
      fixture.database.close();
    }
  },
);
