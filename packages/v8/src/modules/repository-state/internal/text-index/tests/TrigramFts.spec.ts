import { describe, expect, it } from "vitest";
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

async function createFixture() {
  const database = new Database(":memory:");
  const port = new BetterSqliteDatabasePort(database);
  await new SqliteTextIndexMigration().migrate(port);
  const textIndex = new SqliteTextIndexFactory().create(port);
  const chunker = new ChunkingFactory().create({
    hasher: new NodeSha256ChunkHasher(),
  });
  return { database, textIndex, chunker };
}

describe("trigram FTS", () => {
  it("matches camelCase substrings that unicode61 tokens miss", async () => {
    const fixture = await createFixture();

    try {
      const chunking = await fixture.chunker.chunk({
        sourceId: "source:login",
        rootId: "workspace",
        relativePath: "src/LoginForm.ts",
        language: "typescript",
        content: "export class LoginForm { render() { return null; } }\n",
      });

      await fixture.textIndex.coordinator.index({
        workspace: "/repo",
        workspaceSnapshotId: "snapshot-1",
        indexedAt: 100,
        chunking,
      });

      const substring = await fixture.textIndex.search.search({
        workspace: "/repo",
        query: "oginF",
        maximumResults: 10,
      });

      const identifier = await fixture.textIndex.search.search({
        workspace: "/repo",
        query: "LoginForm",
        maximumResults: 10,
      });

      expect(
        substring.matches.some((match) =>
          match.relativePath.endsWith("LoginForm.ts"),
        ),
      ).toBe(true);
      expect(
        identifier.matches.some((match) =>
          match.relativePath.endsWith("LoginForm.ts"),
        ),
      ).toBe(true);
    } finally {
      fixture.database.close();
    }
  });
});
