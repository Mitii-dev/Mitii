import pg from 'pg';

const { Client } = pg;

const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

export const TOOL_DEFINITIONS = [
  {
    name: 'list_tables',
    description: 'List user-defined Postgres tables in the public schema (read-only).',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'describe_table',
    description: 'Describe columns for a Postgres table (read-only).',
    inputSchema: {
      type: 'object',
      properties: {
        table_name: {
          type: 'string',
          description: 'Table name (letters, digits, underscore)',
        },
        schema: {
          type: 'string',
          description: 'Schema name (default public)',
          default: 'public',
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
          description: 'Max rows to return (capped by POSTGRES_MAX_ROWS)',
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
    'truncate ',
    'grant ',
    'revoke ',
    'copy ',
    'call ',
    'do ',
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

function validateIdent(name: string, label: string): string {
  if (!IDENT_RE.test(name)) {
    throw new Error(`Invalid ${label}`);
  }
  return name;
}

export function resolveDatabaseUri(env: NodeJS.ProcessEnv = process.env): string {
  const uri =
    env.DATABASE_URI?.trim() ||
    env.POSTGRES_URI?.trim() ||
    env.DATABASE_URL?.trim() ||
    '';
  if (!uri) {
    throw new Error('DATABASE_URI is required');
  }
  if (
    !uri.startsWith('postgres://') &&
    !uri.startsWith('postgresql://')
  ) {
    throw new Error('DATABASE_URI must start with postgres:// or postgresql://');
  }
  return uri;
}

export function resolveMaxRows(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.POSTGRES_MAX_ROWS?.trim();
  if (!raw) return 50;
  const n = Number(raw);
  if (!Number.isFinite(n)) return 50;
  return Math.max(1, Math.min(200, Math.floor(n)));
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

async function withClient<T>(
  env: NodeJS.ProcessEnv,
  fn: (client: pg.Client) => Promise<T>,
): Promise<T> {
  const client = new Client({
    connectionString: resolveDatabaseUri(env),
    // Prefer read-only session when the role allows it; mutations still blocked in SQL.
    options: '-c default_transaction_read_only=on',
  });
  try {
    await client.connect();
    return await fn(client);
  } finally {
    await client.end().catch(() => undefined);
  }
}

export async function handleToolCall(
  name: string,
  args: Record<string, unknown>,
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }> {
  try {
    if (name === 'list_tables') {
      return await withClient(env, async (client) => {
        const result = await client.query<{ table_name: string }>(
          `SELECT table_name
           FROM information_schema.tables
           WHERE table_schema = 'public'
             AND table_type = 'BASE TABLE'
           ORDER BY table_name`,
        );
        return textResult(
          JSON.stringify(
            result.rows.map((r) => r.table_name),
            null,
            2,
          ),
        );
      });
    }

    if (name === 'describe_table') {
      const tableName =
        typeof args.table_name === 'string' ? args.table_name.trim() : '';
      if (!tableName) return textResult('table_name is required', true);
      const schema =
        typeof args.schema === 'string' && args.schema.trim()
          ? args.schema.trim()
          : 'public';
      const safeTable = validateIdent(tableName, 'table name');
      const safeSchema = validateIdent(schema, 'schema name');
      return await withClient(env, async (client) => {
        const result = await client.query(
          `SELECT column_name, data_type, is_nullable, column_default
           FROM information_schema.columns
           WHERE table_schema = $1 AND table_name = $2
           ORDER BY ordinal_position`,
          [safeSchema, safeTable],
        );
        return textResult(JSON.stringify(result.rows, null, 2));
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
      const wrappedSql = `SELECT * FROM (${sql.replace(/;+\s*$/, '')}) AS mitii_q LIMIT ${safeLimit}`;
      return await withClient(env, async (client) => {
        const result = await client.query(wrappedSql);
        const columns = result.fields.map((f) => f.name);
        return textResult(
          JSON.stringify(
            { limit: safeLimit, columns, rows: result.rows },
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
