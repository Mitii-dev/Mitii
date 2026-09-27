import { existsSync } from 'node:fs';
import Database from 'better-sqlite3';

const TABLE_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

export const TOOL_DEFINITIONS = [
  {
    name: 'list_tables',
    description: 'List user-defined SQLite tables (read-only).',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'describe_table',
    description: 'Describe columns for a SQLite table (read-only).',
    inputSchema: {
      type: 'object',
      properties: {
        table_name: {
          type: 'string',
          description: 'Table name (letters, digits, underscore)',
        },
      },
      required: ['table_name'],
    },
  },
  {
    name: 'query',
    description:
      'Run a read-only SELECT query and return rows plus column names. Mutations are rejected.',
    inputSchema: {
      type: 'object',
      properties: {
        sql: { type: 'string', description: 'SELECT statement only' },
        limit: {
          type: 'number',
          description: 'Max rows to return (capped by SQLITE_MAX_ROWS)',
          default: 50,
        },
      },
      required: ['sql'],
    },
  },
] as const;

export function listToolDefinitions(): ReadonlyArray<{
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}> {
  return TOOL_DEFINITIONS;
}

/** Reject non-SELECT / multi-statement SQL. */
export function rejectMutationSql(sql: string): void {
  const normalized = sql.trim().toLowerCase();
  if (!normalized.startsWith('select') && !normalized.startsWith('with')) {
    throw new Error('Only SELECT (or WITH … SELECT) queries are allowed');
  }
  // Block stacked statements (e.g. "SELECT 1; DROP TABLE x")
  const withoutStrings = stripSqlStrings(normalized);
  if (withoutStrings.includes(';')) {
    const parts = withoutStrings
      .split(';')
      .map((p) => p.trim())
      .filter(Boolean);
    if (parts.length > 1) {
      throw new Error('Multiple SQL statements are not allowed');
    }
  }
  for (const banned of [
    'insert ',
    'update ',
    'delete ',
    'drop ',
    'alter ',
    'create ',
    'attach ',
    'detach ',
    'replace ',
    'pragma ',
    'vacuum',
    'reindex',
  ]) {
    if (withoutStrings.includes(banned)) {
      throw new Error(`Disallowed SQL keyword near: ${banned.trim()}`);
    }
  }
}

function stripSqlStrings(sql: string): string {
  return sql.replace(/'(?:''|[^'])*'/g, "''").replace(/"(?:""|[^"])*"/g, '""');
}

function validateTableName(tableName: string): string {
  if (!TABLE_NAME_RE.test(tableName)) {
    throw new Error('Invalid table name');
  }
  return tableName;
}

export function resolveSqlitePath(env: NodeJS.ProcessEnv = process.env): string {
  const path = env.SQLITE_PATH?.trim() ?? '';
  if (!path) {
    throw new Error('SQLITE_PATH is required');
  }
  if (!existsSync(path)) {
    throw new Error(`SQLITE_PATH file not found: ${path}`);
  }
  return path;
}

export function resolveMaxRows(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.SQLITE_MAX_ROWS?.trim();
  if (!raw) return 50;
  const n = Number(raw);
  if (!Number.isFinite(n)) return 50;
  return Math.max(1, Math.min(200, Math.floor(n)));
}

export function openReadonlyDatabase(
  env: NodeJS.ProcessEnv = process.env,
): Database.Database {
  const path = resolveSqlitePath(env);
  const db = new Database(path, { readonly: true, fileMustExist: true });
  db.pragma('query_only = ON');
  return db;
}

export async function handleToolCall(
  name: string,
  args: Record<string, unknown>,
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }> {
  try {
    if (name === 'list_tables') {
      const db = openReadonlyDatabase(env);
      try {
        const rows = db
          .prepare(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
          )
          .all() as Array<{ name: string }>;
        return textResult(JSON.stringify(rows.map((r) => r.name), null, 2));
      } finally {
        db.close();
      }
    }

    if (name === 'describe_table') {
      const tableName =
        typeof args.table_name === 'string' ? args.table_name.trim() : '';
      if (!tableName) {
        return textResult('table_name is required', true);
      }
      const safe = validateTableName(tableName);
      const db = openReadonlyDatabase(env);
      try {
        const rows = db.prepare(`PRAGMA table_info(${safe})`).all() as Array<{
          cid: number;
          name: string;
          type: string;
          notnull: number;
          dflt_value: unknown;
          pk: number;
        }>;
        const mapped = rows.map((row) => ({
          cid: row.cid,
          name: row.name,
          type: row.type,
          notnull: Boolean(row.notnull),
          default: row.dflt_value,
          pk: Boolean(row.pk),
        }));
        return textResult(JSON.stringify(mapped, null, 2));
      } finally {
        db.close();
      }
    }

    if (name === 'query') {
      const sql = typeof args.sql === 'string' ? args.sql.trim() : '';
      if (!sql) {
        return textResult('sql is required', true);
      }
      rejectMutationSql(sql);
      const maxRows = resolveMaxRows(env);
      const requested =
        typeof args.limit === 'number' && Number.isFinite(args.limit)
          ? Math.floor(args.limit)
          : maxRows;
      const safeLimit = Math.max(0, Math.min(requested, maxRows));
      const wrappedSql = `SELECT * FROM (${sql.replace(/;+\s*$/, '')}) LIMIT ${safeLimit}`;
      const db = openReadonlyDatabase(env);
      try {
        const stmt = db.prepare(wrappedSql);
        const rows = stmt.all() as Array<Record<string, unknown>>;
        const columns =
          rows.length > 0
            ? Object.keys(rows[0]!)
            : stmt.columns().map((c) => c.name);
        return textResult(
          JSON.stringify({ limit: safeLimit, columns, rows }, null, 2),
        );
      } finally {
        db.close();
      }
    }

    return textResult(`Unknown tool: ${name}`, true);
  } catch (error) {
    return textResult(
      error instanceof Error ? error.message : String(error),
      true,
    );
  }
}

function textResult(
  text: string,
  isError = false,
): { content: Array<{ type: 'text'; text: string }>; isError?: boolean } {
  return {
    content: [{ type: 'text', text }],
    ...(isError ? { isError: true } : {}),
  };
}
