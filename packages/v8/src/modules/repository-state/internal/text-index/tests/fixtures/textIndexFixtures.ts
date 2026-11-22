import Database from "better-sqlite3";

import {
  ChunkingFactory,
  NodeSha256ChunkHasher,
} from "../../../chunking";

import type {
  SqliteDatabasePort,
  SqliteStatementPort,
} from "../../../shared/sqlite";

import {
  SqliteTextIndexFactory,
  SqliteTextIndexMigration,
} from "../../index";

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

export async function createFixture() {
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

