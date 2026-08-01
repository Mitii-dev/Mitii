/**
 * Host-injected SQLite opener.
 *
 * VS Code supplies Electron-native bindings; CLI supplies better-sqlite3.
 * Indexing and repository-context factories require this injection so native
 * bindings never leak into `@mitii/v8` / `@mitii/sdk`.
 */
export interface HostSqliteOpenOptions {
  readonly?: boolean;
  fileMustExist?: boolean;
}

/**
 * Minimal surface used by host indexing + retrieval (better-sqlite3 compatible).
 * Kept structural/loose so Electron and Node bindings both assign cleanly.
 */
export type HostSqliteDatabase = {
  pragma(source: string, options?: unknown): unknown;
  prepare(sql: string): unknown;
  exec(sql: string): void;
  // better-sqlite3 Transaction is callable; hosts pass the native object through.
  transaction: (...args: never[]) => unknown;
  close(): void;
};

export type OpenHostSqliteDatabase = (
  filename: string,
  options?: HostSqliteOpenOptions,
) => HostSqliteDatabase;
