/**
 * Connection profiles for @mitii/mcp-sql.
 *
 * Single connection:
 *   SQL_MCP_URI / DATABASE_URI / SQLITE_PATH
 *   SQL_MCP_DIALECT=postgresql|mysql|mariadb|sqlite (optional; inferred)
 *   SQL_MCP_NAME=default (optional)
 *
 * Multi connection (JSON array):
 *   SQL_MCP_CONNECTIONS=[{"name":"local","uri":"postgresql://..."}]
 */

export type SqlDialect = 'postgresql' | 'mysql' | 'mariadb' | 'sqlite';

export interface SqlConnectionProfile {
  name: string;
  uri: string;
  dialect: SqlDialect;
}

export function inferDialectFromUri(uri: string): SqlDialect {
  const raw = uri.trim().toLowerCase();
  if (
    raw.startsWith('postgres://') ||
    raw.startsWith('postgresql://')
  ) {
    return 'postgresql';
  }
  if (raw.startsWith('mysql://') || raw.startsWith('mysql2://')) {
    return 'mysql';
  }
  if (raw.startsWith('mariadb://')) {
    return 'mariadb';
  }
  if (
    raw.startsWith('sqlite:') ||
    raw.startsWith('file:') ||
    raw.endsWith('.db') ||
    raw.endsWith('.sqlite') ||
    raw.endsWith('.sqlite3')
  ) {
    return 'sqlite';
  }
  // Bare filesystem path → sqlite
  if (!raw.includes('://')) {
    return 'sqlite';
  }
  throw new Error(
    `Cannot infer SQL dialect from URI (set SQL_MCP_DIALECT). Got: ${uri.slice(0, 48)}`,
  );
}

export function normalizeDialect(value: string | undefined): SqlDialect | undefined {
  if (!value) return undefined;
  const raw = value.trim().toLowerCase();
  if (raw === 'postgres' || raw === 'postgresql' || raw === 'pg') {
    return 'postgresql';
  }
  if (raw === 'mysql') return 'mysql';
  if (raw === 'mariadb') return 'mariadb';
  if (raw === 'sqlite' || raw === 'sqlite3') return 'sqlite';
  throw new Error(`Unsupported SQL_MCP_DIALECT: ${value}`);
}

function parseConnectionsJson(raw: string): SqlConnectionProfile[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('SQL_MCP_CONNECTIONS must be valid JSON');
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error('SQL_MCP_CONNECTIONS must be a non-empty JSON array');
  }
  return parsed.map((entry, index) => {
    if (!entry || typeof entry !== 'object') {
      throw new Error(`SQL_MCP_CONNECTIONS[${index}] must be an object`);
    }
    const rec = entry as Record<string, unknown>;
    const name =
      typeof rec.name === 'string' && rec.name.trim()
        ? rec.name.trim()
        : `conn_${index + 1}`;
    const uri =
      (typeof rec.uri === 'string' && rec.uri.trim()) ||
      (typeof rec.url === 'string' && rec.url.trim()) ||
      (typeof rec.path === 'string' && rec.path.trim()) ||
      '';
    if (!uri) {
      throw new Error(`SQL_MCP_CONNECTIONS[${index}] needs uri/url/path`);
    }
    const dialect =
      normalizeDialect(
        typeof rec.dialect === 'string'
          ? rec.dialect
          : typeof rec.type === 'string'
            ? rec.type
            : undefined,
      ) ?? inferDialectFromUri(uri);
    return { name, uri, dialect };
  });
}

export function resolveConnectionProfiles(
  env: NodeJS.ProcessEnv = process.env,
): SqlConnectionProfile[] {
  const multi = env.SQL_MCP_CONNECTIONS?.trim();
  if (multi) {
    return parseConnectionsJson(multi);
  }

  const uri =
    env.SQL_MCP_URI?.trim() ||
    env.DATABASE_URI?.trim() ||
    env.POSTGRES_URI?.trim() ||
    env.DATABASE_URL?.trim() ||
    env.MYSQL_URI?.trim() ||
    env.SQLITE_PATH?.trim() ||
    '';
  if (!uri) {
    throw new Error(
      'SQL_MCP_URI (or DATABASE_URI / SQLITE_PATH / SQL_MCP_CONNECTIONS) is required',
    );
  }
  const dialect =
    normalizeDialect(env.SQL_MCP_DIALECT) ?? inferDialectFromUri(uri);
  const name =
    env.SQL_MCP_NAME?.trim() ||
    env.SQL_MCP_CONNECTION?.trim() ||
    'default';
  return [{ name, uri, dialect }];
}

export function pickConnection(
  profiles: readonly SqlConnectionProfile[],
  connectionName: string | undefined,
): SqlConnectionProfile {
  if (profiles.length === 0) {
    throw new Error('No SQL connections configured');
  }
  if (!connectionName || !connectionName.trim()) {
    return profiles[0]!;
  }
  const wanted = connectionName.trim();
  const found = profiles.find((p) => p.name === wanted);
  if (!found) {
    throw new Error(
      `Unknown connection "${wanted}". Available: ${profiles.map((p) => p.name).join(', ')}`,
    );
  }
  return found;
}

export function resolveMaxRows(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.SQL_MAX_ROWS?.trim() || env.POSTGRES_MAX_ROWS?.trim();
  if (!raw) return 50;
  const n = Number(raw);
  if (!Number.isFinite(n)) return 50;
  return Math.max(1, Math.min(200, Math.floor(n)));
}
