/** Install-form keys that must not be written into `.mitii/mcp.json` env. */
export const DB_FORM_ONLY_KEYS = new Set([
  'MITII_DB_HOST',
  'MITII_DB_PORT',
  'MITII_DB_USER',
  'MITII_DB_PASSWORD',
  'MITII_DB_NAME',
  'MITII_DB_PATH',
]);

export function trimSecret(
  secrets: Record<string, string> | undefined,
  key: string,
): string {
  return secrets?.[key]?.trim() ?? '';
}

export function normalizeSqlDialect(raw: string): string | null {
  const v = raw.trim().toLowerCase();
  if (!v) return null;
  if (v === 'postgres' || v === 'postgresql' || v === 'pg') return 'postgresql';
  if (v === 'mysql') return 'mysql';
  if (v === 'mariadb') return 'mariadb';
  if (v === 'sqlite' || v === 'sqlite3') return 'sqlite';
  return null;
}

function defaultPortForScheme(scheme: string): string {
  if (scheme === 'postgresql' || scheme === 'postgres') return '5432';
  if (scheme === 'mysql' || scheme === 'mariadb') return '3306';
  if (scheme === 'mongodb' || scheme === 'mongodb+srv') return '27017';
  return '';
}

/** Build `scheme://[user[:pass]@]host:port/db` from structured install fields. */
export function composeDbConnectionUri(params: {
  scheme: string;
  host: string;
  port?: string;
  user?: string;
  password?: string;
  database: string;
}): string {
  const scheme = params.scheme.trim().toLowerCase();
  const host = params.host.trim();
  const database = params.database.trim();
  if (!host) throw new Error('Host is required');
  if (!database) throw new Error('Database is required');
  const port =
    params.port?.trim() || defaultPortForScheme(scheme) || undefined;
  const user = params.user?.trim() ?? '';
  const password = params.password ?? '';
  let auth = '';
  if (user) {
    auth = encodeURIComponent(user);
    if (password) auth += `:${encodeURIComponent(password)}`;
    auth += '@';
  }
  const portPart = port ? `:${port}` : '';
  const dbPart = encodeURIComponent(database);
  return `${scheme}://${auth}${host}${portPart}/${dbPart}`;
}

export function resolvePostgresUri(
  secrets: Record<string, string> | undefined,
): string | null {
  const full = trimSecret(secrets, 'DATABASE_URI');
  if (full) return full;
  const host = trimSecret(secrets, 'MITII_DB_HOST');
  const database = trimSecret(secrets, 'MITII_DB_NAME');
  if (!host || !database) return null;
  return composeDbConnectionUri({
    scheme: 'postgresql',
    host,
    port: trimSecret(secrets, 'MITII_DB_PORT'),
    user: trimSecret(secrets, 'MITII_DB_USER'),
    password: trimSecret(secrets, 'MITII_DB_PASSWORD'),
    database,
  });
}

export function resolveMongoUri(
  secrets: Record<string, string> | undefined,
): string | null {
  const full = trimSecret(secrets, 'MCP_MONGODB_URI');
  if (full) return full;
  const host = trimSecret(secrets, 'MITII_DB_HOST');
  const database = trimSecret(secrets, 'MITII_DB_NAME');
  if (!host || !database) return null;
  return composeDbConnectionUri({
    scheme: 'mongodb',
    host,
    port: trimSecret(secrets, 'MITII_DB_PORT'),
    user: trimSecret(secrets, 'MITII_DB_USER'),
    password: trimSecret(secrets, 'MITII_DB_PASSWORD'),
    database,
  });
}

export function resolveSqlConnection(
  secrets: Record<string, string> | undefined,
): { uri: string; dialect?: string } | null {
  const full = trimSecret(secrets, 'SQL_MCP_URI');
  const dialectRaw = trimSecret(secrets, 'SQL_MCP_DIALECT');
  const dialect = normalizeSqlDialect(dialectRaw);

  if (full) {
    return dialect ? { uri: full, dialect } : { uri: full };
  }

  if (!dialect) return null;

  if (dialect === 'sqlite') {
    const path =
      trimSecret(secrets, 'MITII_DB_PATH') ||
      trimSecret(secrets, 'SQLITE_PATH');
    if (!path) return null;
    return { uri: path, dialect };
  }

  const host = trimSecret(secrets, 'MITII_DB_HOST');
  const database = trimSecret(secrets, 'MITII_DB_NAME');
  if (!host || !database) return null;
  const scheme =
    dialect === 'postgresql'
      ? 'postgresql'
      : dialect === 'mariadb'
        ? 'mariadb'
        : 'mysql';
  return {
    uri: composeDbConnectionUri({
      scheme,
      host,
      port: trimSecret(secrets, 'MITII_DB_PORT'),
      user: trimSecret(secrets, 'MITII_DB_USER'),
      password: trimSecret(secrets, 'MITII_DB_PASSWORD'),
      database,
    }),
    dialect,
  };
}
