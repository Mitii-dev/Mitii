export interface SqliteRunResult {
  changes: number;
  lastInsertRowid: number | bigint;
}

export interface SqliteReadStatementPort {
  get(...parameters: unknown[]): unknown;
  all(...parameters: unknown[]): unknown[];
}

export interface SqliteStatementPort
  extends SqliteReadStatementPort {
  run(...parameters: unknown[]): SqliteRunResult;
}

export interface SqliteReadDatabasePort {
  prepare(sql: string): SqliteReadStatementPort;
}

export interface SqliteDatabasePort
  extends SqliteReadDatabasePort {
  prepare(sql: string): SqliteStatementPort;
  exec(sql: string): void;

  /**
   * Executes operation atomically and rolls back when it throws.
   */
  transaction<T>(operation: () => T): T;
}

