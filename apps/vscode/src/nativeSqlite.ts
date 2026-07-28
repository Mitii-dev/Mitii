import { existsSync } from 'node:fs';
import { join } from 'node:path';

import Database from 'better-sqlite3';

type SqliteDatabase = Database.Database;
type SqliteOptions = Database.Options;

export type NativeSqliteDatabase = SqliteDatabase;

const NATIVE_BINDING_FILE = 'better_sqlite3.node';

export function openSqliteDatabase(
  filename: string,
  options: SqliteOptions = {},
): SqliteDatabase {
  return new Database(filename, {
    ...options,
    nativeBinding: resolveNativeSqliteBinding(),
  });
}

export function resolveNativeSqliteBinding(): string {
  const override = process.env.MITII_SQLITE_NATIVE_BINDING;
  if (override && existsSync(override)) {
    return override;
  }

  const bundled = join(__dirname, 'native', NATIVE_BINDING_FILE);
  if (existsSync(bundled)) {
    return bundled;
  }

  throw new Error(
    `Mitii SQLite native binding is missing at ${bundled}. Run the VS Code package build so ${NATIVE_BINDING_FILE} is staged into dist/native.`,
  );
}
