/**
 * Dialect-agnostic SQL session wrappers.
 */

import Database from 'better-sqlite3';
import mysql from 'mysql2/promise';
import pg from 'pg';

import type { SqlConnectionProfile, SqlDialect } from './connections.js';

export interface SqlQueryResult {
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
  command?: string;
}

export interface SqlSession {
  dialect: SqlDialect;
  query(sql: string, params?: unknown[]): Promise<SqlQueryResult>;
  close(): Promise<void>;
}

function rowsFromPg(result: pg.QueryResult): SqlQueryResult {
  return {
    columns: result.fields.map((f) => f.name),
    rows: result.rows as Record<string, unknown>[],
    rowCount: result.rowCount ?? result.rows.length,
    command: result.command,
  };
}

async function openPostgres(
  profile: SqlConnectionProfile,
  readOnly: boolean,
): Promise<SqlSession> {
  const client = new pg.Client({
    connectionString: profile.uri,
    ...(readOnly ? { options: '-c default_transaction_read_only=on' } : {}),
  });
  await client.connect();
  return {
    dialect: 'postgresql',
    async query(sql, params = []) {
      const result = await client.query(sql, params);
      return rowsFromPg(result);
    },
    async close() {
      await client.end().catch(() => undefined);
    },
  };
}

async function openMysqlFamily(
  profile: SqlConnectionProfile,
  readOnly: boolean,
): Promise<SqlSession> {
  const conn = await mysql.createConnection(profile.uri);
  if (readOnly) {
    await conn.query('SET SESSION TRANSACTION READ ONLY');
  }
  return {
    dialect: profile.dialect,
    async query(sql, params = []) {
      const [rows, fields] = await conn.query(sql, params);
      if (Array.isArray(rows)) {
        const list = rows as Record<string, unknown>[];
        const columns =
          Array.isArray(fields) && fields.length > 0
            ? (fields as Array<{ name: string }>).map((f) => f.name)
            : list.length > 0
              ? Object.keys(list[0]!)
              : [];
        return {
          columns,
          rows: list,
          rowCount: list.length,
        };
      }
      const header = rows as mysql.ResultSetHeader;
      return {
        columns: [],
        rows: [],
        rowCount: header.affectedRows ?? 0,
        command: 'OK',
      };
    },
    async close() {
      await conn.end().catch(() => undefined);
    },
  };
}

async function openSqlite(
  profile: SqlConnectionProfile,
  readOnly: boolean,
): Promise<SqlSession> {
  let path = profile.uri;
  if (path.startsWith('sqlite:')) {
    path = path.slice('sqlite:'.length);
  }
  if (path.startsWith('file:')) {
    path = path.slice('file:'.length);
  }
  const db = new Database(path, { readonly: readOnly, fileMustExist: readOnly });
  return {
    dialect: 'sqlite',
    async query(sql, params = []) {
      const stmt = db.prepare(sql);
      const isSelect =
        /^\s*(select|with|pragma|explain)\b/i.test(sql) ||
        stmt.reader;
      if (isSelect) {
        const rows = stmt.all(...params) as Record<string, unknown>[];
        const columns =
          rows.length > 0
            ? Object.keys(rows[0]!)
            : stmt.columns().map((c) => c.name);
        return { columns, rows, rowCount: rows.length };
      }
      const info = stmt.run(...params);
      return {
        columns: [],
        rows: [],
        rowCount: info.changes,
        command: 'OK',
      };
    },
    async close() {
      db.close();
    },
  };
}

export async function openSqlSession(
  profile: SqlConnectionProfile,
  readOnly: boolean,
): Promise<SqlSession> {
  if (profile.dialect === 'postgresql') {
    return openPostgres(profile, readOnly);
  }
  if (profile.dialect === 'sqlite') {
    return openSqlite(profile, readOnly);
  }
  return openMysqlFamily(profile, readOnly);
}

export async function withSqlSession<T>(
  profile: SqlConnectionProfile,
  readOnly: boolean,
  fn: (session: SqlSession) => Promise<T>,
): Promise<T> {
  const session = await openSqlSession(profile, readOnly);
  try {
    return await fn(session);
  } finally {
    await session.close();
  }
}
