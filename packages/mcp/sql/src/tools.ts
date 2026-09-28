import {
  assertWriteAllowed,
  resolveDbAccessMode,
  type DbAccessMode,
} from './access.js';
import { withSqlSession } from './client.js';
import {
  pickConnection,
  resolveConnectionProfiles,
  resolveMaxRows,
  type SqlConnectionProfile,
} from './connections.js';
import {
  describeTableSql,
  explainSql,
  listForeignKeysSql,
  listTablesSql,
  sampleRowsSql,
  wrapSelectWithLimit,
} from './dialect.js';
import { assertDmlSql, rejectMutationSql } from './sqlGuard.js';

const CONNECTION_PROP = {
  type: 'string',
  description:
    'Connection profile name (optional when only one connection is configured)',
} as const;

const READ_TOOL_DEFINITIONS = [
  {
    name: 'list_connections',
    description: 'List configured SQL connection profiles for this MCP server.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'list_tables',
    description: 'List tables and views (schema + name + type).',
    inputSchema: {
      type: 'object',
      properties: { connection: CONNECTION_PROP },
      additionalProperties: false,
    },
  },
  {
    name: 'describe_table',
    description: 'Describe columns for a table.',
    inputSchema: {
      type: 'object',
      properties: {
        connection: CONNECTION_PROP,
        table_name: {
          type: 'string',
          description: 'Table name (letters, digits, underscore)',
        },
        schema: {
          type: 'string',
          description: 'Schema / database name (Postgres default: public)',
        },
      },
      required: ['table_name'],
    },
  },
  {
    name: 'list_foreign_keys',
    description: 'List foreign-key constraints for a table.',
    inputSchema: {
      type: 'object',
      properties: {
        connection: CONNECTION_PROP,
        table_name: { type: 'string' },
        schema: { type: 'string' },
      },
      required: ['table_name'],
    },
  },
  {
    name: 'sample_rows',
    description: 'Preview sample rows from a table (bounded).',
    inputSchema: {
      type: 'object',
      properties: {
        connection: CONNECTION_PROP,
        table_name: { type: 'string' },
        schema: { type: 'string' },
        limit: {
          type: 'number',
          description: 'Max rows (capped by SQL_MAX_ROWS)',
          default: 10,
        },
      },
      required: ['table_name'],
    },
  },
  {
    name: 'query',
    description:
      'Run a SELECT / WITH…SELECT query with safety guards. Mutations are rejected — use execute_write.',
    inputSchema: {
      type: 'object',
      properties: {
        connection: CONNECTION_PROP,
        sql: { type: 'string', description: 'SELECT statement only' },
        limit: {
          type: 'number',
          description: 'Max rows to return (capped by SQL_MAX_ROWS)',
          default: 50,
        },
      },
      required: ['sql'],
    },
  },
  {
    name: 'explain_query',
    description: 'Show the execution plan for a SELECT query (no row results).',
    inputSchema: {
      type: 'object',
      properties: {
        connection: CONNECTION_PROP,
        sql: { type: 'string', description: 'SELECT statement to explain' },
      },
      required: ['sql'],
    },
  },
  {
    name: 'ping',
    description: 'Health check — verifies a connection can run SELECT 1.',
    inputSchema: {
      type: 'object',
      properties: { connection: CONNECTION_PROP },
      additionalProperties: false,
    },
  },
] as const;

const WRITE_TOOL_DEFINITIONS = [
  {
    name: 'execute_write',
    description:
      'Run a single INSERT / UPDATE / DELETE / REPLACE (readwrite access only). DDL is rejected.',
    inputSchema: {
      type: 'object',
      properties: {
        connection: CONNECTION_PROP,
        sql: {
          type: 'string',
          description: 'INSERT, UPDATE, DELETE, or REPLACE statement',
        },
      },
      required: ['sql'],
    },
  },
] as const;

export const TOOL_DEFINITIONS = [
  ...READ_TOOL_DEFINITIONS,
  ...WRITE_TOOL_DEFINITIONS,
] as const;

export function listToolDefinitions(
  access: DbAccessMode = resolveDbAccessMode(),
): ReadonlyArray<{
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}> {
  if (access === 'readwrite') return TOOL_DEFINITIONS;
  return READ_TOOL_DEFINITIONS;
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

function connectionArg(args: Record<string, unknown>): string | undefined {
  return typeof args.connection === 'string' ? args.connection.trim() : undefined;
}

function resolveProfile(
  env: NodeJS.ProcessEnv,
  args: Record<string, unknown>,
): SqlConnectionProfile {
  return pickConnection(resolveConnectionProfiles(env), connectionArg(args));
}

export async function handleToolCall(
  name: string,
  args: Record<string, unknown>,
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }> {
  try {
    const access = resolveDbAccessMode(env);
    if (name === 'execute_write') {
      assertWriteAllowed(access, name);
    }

    if (name === 'list_connections') {
      const profiles = resolveConnectionProfiles(env);
      return textResult(
        JSON.stringify(
          profiles.map((p) => ({
            name: p.name,
            dialect: p.dialect,
            // Redact credentials — show scheme + host/path only.
            uri: redactUri(p.uri),
          })),
          null,
          2,
        ),
      );
    }

    const profile = resolveProfile(env, args);

    if (name === 'list_tables') {
      const { sql, params } = listTablesSql(profile.dialect);
      return await withSqlSession(profile, true, async (session) => {
        const result = await session.query(sql, params);
        return textResult(JSON.stringify(result.rows, null, 2));
      });
    }

    if (name === 'describe_table') {
      const tableName =
        typeof args.table_name === 'string' ? args.table_name.trim() : '';
      if (!tableName) return textResult('table_name is required', true);
      const schema =
        typeof args.schema === 'string' ? args.schema.trim() : undefined;
      const { sql, params } = describeTableSql(
        profile.dialect,
        tableName,
        schema,
      );
      return await withSqlSession(profile, true, async (session) => {
        const result = await session.query(sql, params);
        return textResult(JSON.stringify(result.rows, null, 2));
      });
    }

    if (name === 'list_foreign_keys') {
      const tableName =
        typeof args.table_name === 'string' ? args.table_name.trim() : '';
      if (!tableName) return textResult('table_name is required', true);
      const schema =
        typeof args.schema === 'string' ? args.schema.trim() : undefined;
      const { sql, params } = listForeignKeysSql(
        profile.dialect,
        tableName,
        schema,
      );
      return await withSqlSession(profile, true, async (session) => {
        const result = await session.query(sql, params);
        return textResult(JSON.stringify(result.rows, null, 2));
      });
    }

    if (name === 'sample_rows') {
      const tableName =
        typeof args.table_name === 'string' ? args.table_name.trim() : '';
      if (!tableName) return textResult('table_name is required', true);
      const schema =
        typeof args.schema === 'string' ? args.schema.trim() : undefined;
      const maxRows = resolveMaxRows(env);
      const requested =
        typeof args.limit === 'number' && Number.isFinite(args.limit)
          ? Math.floor(args.limit)
          : 10;
      const limit = Math.max(1, Math.min(requested, maxRows));
      const { sql, params } = sampleRowsSql(
        profile.dialect,
        tableName,
        schema,
        limit,
      );
      return await withSqlSession(profile, true, async (session) => {
        const result = await session.query(sql, params);
        return textResult(
          JSON.stringify(
            {
              connection: profile.name,
              dialect: profile.dialect,
              limit,
              columns: result.columns,
              rows: result.rows,
              rowCount: result.rowCount,
            },
            null,
            2,
          ),
        );
      });
    }

    if (name === 'query') {
      const sql = typeof args.sql === 'string' ? args.sql.trim() : '';
      if (!sql) return textResult('sql is required', true);
      rejectMutationSql(sql);
      const maxRows = resolveMaxRows(env);
      const requested =
        typeof args.limit === 'number' && Number.isFinite(args.limit)
          ? Math.floor(args.limit)
          : maxRows;
      const safeLimit = Math.max(0, Math.min(requested, maxRows));
      const wrapped = wrapSelectWithLimit(profile.dialect, sql, safeLimit);
      const started = Date.now();
      return await withSqlSession(profile, true, async (session) => {
        const result = await session.query(wrapped);
        return textResult(
          JSON.stringify(
            {
              connection: profile.name,
              dialect: profile.dialect,
              limit: safeLimit,
              columns: result.columns,
              rows: result.rows,
              rowCount: result.rowCount,
              truncated: result.rowCount >= safeLimit && safeLimit > 0,
              executionTimeMs: Date.now() - started,
            },
            null,
            2,
          ),
        );
      });
    }

    if (name === 'explain_query') {
      const sql = typeof args.sql === 'string' ? args.sql.trim() : '';
      if (!sql) return textResult('sql is required', true);
      rejectMutationSql(sql);
      const planSql = explainSql(profile.dialect, sql);
      return await withSqlSession(profile, true, async (session) => {
        const result = await session.query(planSql);
        return textResult(
          JSON.stringify(
            {
              connection: profile.name,
              dialect: profile.dialect,
              plan: result.rows,
            },
            null,
            2,
          ),
        );
      });
    }

    if (name === 'ping') {
      return await withSqlSession(profile, true, async (session) => {
        await session.query('SELECT 1 AS ok');
        return textResult(
          JSON.stringify(
            {
              ok: true,
              connection: profile.name,
              dialect: profile.dialect,
            },
            null,
            2,
          ),
        );
      });
    }

    if (name === 'execute_write') {
      const sql = typeof args.sql === 'string' ? args.sql.trim() : '';
      if (!sql) return textResult('sql is required', true);
      assertDmlSql(sql);
      return await withSqlSession(profile, false, async (session) => {
        const result = await session.query(sql.replace(/;+\s*$/, ''));
        return textResult(
          JSON.stringify(
            {
              connection: profile.name,
              dialect: profile.dialect,
              rowCount: result.rowCount,
              command: result.command ?? 'OK',
            },
            null,
            2,
          ),
        );
      });
    }

    return textResult(`Unknown tool: ${name}`, true);
  } catch (error) {
    return textResult(
      error instanceof Error ? error.message : String(error),
      true,
    );
  }
}

function redactUri(uri: string): string {
  try {
    if (!uri.includes('://')) {
      return uri;
    }
    const u = new URL(uri);
    if (u.password) u.password = '***';
    if (u.username) u.username = u.username ? '***' : '';
    return u.toString();
  } catch {
    return uri.replace(/\/\/([^/@]+)@/, '//***@');
  }
}
