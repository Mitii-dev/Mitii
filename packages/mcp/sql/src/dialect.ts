/**
 * Dialect-specific introspection / explain SQL for @mitii/mcp-sql.
 */

import type { SqlDialect } from './connections.js';
import { validateIdent } from './sqlGuard.js';

export function quoteIdent(dialect: SqlDialect, name: string): string {
  const safe = validateIdent(name, 'identifier');
  if (dialect === 'mysql' || dialect === 'mariadb') {
    return `\`${safe}\``;
  }
  return `"${safe}"`;
}

export function listTablesSql(dialect: SqlDialect): {
  sql: string;
  params: unknown[];
} {
  if (dialect === 'postgresql') {
    return {
      sql: `SELECT table_schema AS schema, table_name AS name, table_type AS type
            FROM information_schema.tables
            WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
            ORDER BY table_schema, table_name`,
      params: [],
    };
  }
  if (dialect === 'sqlite') {
    return {
      sql: `SELECT 'main' AS schema, name, type
            FROM sqlite_master
            WHERE type IN ('table', 'view')
              AND name NOT LIKE 'sqlite_%'
            ORDER BY name`,
      params: [],
    };
  }
  // mysql / mariadb
  return {
    sql: `SELECT table_schema AS \`schema\`, table_name AS name, table_type AS type
          FROM information_schema.tables
          WHERE table_schema = DATABASE()
          ORDER BY table_name`,
    params: [],
  };
}

export function describeTableSql(
  dialect: SqlDialect,
  table: string,
  schema: string | undefined,
): { sql: string; params: unknown[] } {
  const safeTable = validateIdent(table, 'table name');
  if (dialect === 'postgresql') {
    const safeSchema = validateIdent(schema?.trim() || 'public', 'schema name');
    return {
      sql: `SELECT column_name, data_type, is_nullable, column_default
            FROM information_schema.columns
            WHERE table_schema = $1 AND table_name = $2
            ORDER BY ordinal_position`,
      params: [safeSchema, safeTable],
    };
  }
  if (dialect === 'sqlite') {
    // PRAGMA cannot bind table name — validated identifier only.
    return {
      sql: `PRAGMA table_info(${quoteIdent(dialect, safeTable)})`,
      params: [],
    };
  }
  const safeSchema = schema?.trim()
    ? validateIdent(schema.trim(), 'schema name')
    : undefined;
  return {
    sql: `SELECT column_name, data_type, is_nullable, column_default, column_key, extra
          FROM information_schema.columns
          WHERE table_schema = COALESCE(?, DATABASE())
            AND table_name = ?
          ORDER BY ordinal_position`,
    params: [safeSchema ?? null, safeTable],
  };
}

export function listForeignKeysSql(
  dialect: SqlDialect,
  table: string,
  schema: string | undefined,
): { sql: string; params: unknown[] } {
  const safeTable = validateIdent(table, 'table name');
  if (dialect === 'postgresql') {
    const safeSchema = validateIdent(schema?.trim() || 'public', 'schema name');
    return {
      sql: `SELECT
              tc.constraint_name,
              kcu.column_name,
              ccu.table_schema AS foreign_table_schema,
              ccu.table_name AS foreign_table_name,
              ccu.column_name AS foreign_column_name
            FROM information_schema.table_constraints AS tc
            JOIN information_schema.key_column_usage AS kcu
              ON tc.constraint_name = kcu.constraint_name
             AND tc.table_schema = kcu.table_schema
            JOIN information_schema.constraint_column_usage AS ccu
              ON ccu.constraint_name = tc.constraint_name
             AND ccu.table_schema = tc.table_schema
            WHERE tc.constraint_type = 'FOREIGN KEY'
              AND tc.table_schema = $1
              AND tc.table_name = $2
            ORDER BY tc.constraint_name, kcu.ordinal_position`,
      params: [safeSchema, safeTable],
    };
  }
  if (dialect === 'sqlite') {
    return {
      sql: `PRAGMA foreign_key_list(${quoteIdent(dialect, safeTable)})`,
      params: [],
    };
  }
  const safeSchema = schema?.trim()
    ? validateIdent(schema.trim(), 'schema name')
    : undefined;
  return {
    sql: `SELECT
            constraint_name,
            column_name,
            referenced_table_schema AS foreign_table_schema,
            referenced_table_name AS foreign_table_name,
            referenced_column_name AS foreign_column_name
          FROM information_schema.key_column_usage
          WHERE table_schema = COALESCE(?, DATABASE())
            AND table_name = ?
            AND referenced_table_name IS NOT NULL
          ORDER BY constraint_name, ordinal_position`,
    params: [safeSchema ?? null, safeTable],
  };
}

export function sampleRowsSql(
  dialect: SqlDialect,
  table: string,
  schema: string | undefined,
  limit: number,
): { sql: string; params: unknown[] } {
  const safeTable = validateIdent(table, 'table name');
  const safeLimit = Math.max(1, Math.min(200, Math.floor(limit)));
  if (dialect === 'postgresql') {
    const safeSchema = validateIdent(schema?.trim() || 'public', 'schema name');
    return {
      sql: `SELECT * FROM ${quoteIdent(dialect, safeSchema)}.${quoteIdent(dialect, safeTable)} LIMIT ${safeLimit}`,
      params: [],
    };
  }
  if (dialect === 'sqlite') {
    return {
      sql: `SELECT * FROM ${quoteIdent(dialect, safeTable)} LIMIT ${safeLimit}`,
      params: [],
    };
  }
  const qualified = schema?.trim()
    ? `${quoteIdent(dialect, validateIdent(schema.trim(), 'schema name'))}.${quoteIdent(dialect, safeTable)}`
    : quoteIdent(dialect, safeTable);
  return {
    sql: `SELECT * FROM ${qualified} LIMIT ${safeLimit}`,
    params: [],
  };
}

export function explainSql(dialect: SqlDialect, query: string): string {
  const cleaned = query.replace(/;+\s*$/, '').trim();
  if (dialect === 'postgresql') {
    return `EXPLAIN (FORMAT TEXT) ${cleaned}`;
  }
  if (dialect === 'sqlite') {
    return `EXPLAIN QUERY PLAN ${cleaned}`;
  }
  return `EXPLAIN ${cleaned}`;
}

export function wrapSelectWithLimit(
  dialect: SqlDialect,
  sql: string,
  limit: number,
): string {
  const cleaned = sql.replace(/;+\s*$/, '').trim();
  const safeLimit = Math.max(0, Math.floor(limit));
  if (dialect === 'postgresql') {
    return `SELECT * FROM (${cleaned}) AS mitii_q LIMIT ${safeLimit}`;
  }
  // MySQL/MariaDB/SQLite also accept subquery wrap
  return `SELECT * FROM (${cleaned}) AS mitii_q LIMIT ${safeLimit}`;
}
