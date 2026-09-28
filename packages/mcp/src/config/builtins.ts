import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

import type { McpServerConfig } from '../contracts/types.js';

/**
 * Prefer a workspace-linked `@mitii/mcp-*` DB bin (monorepo / local),
 * else fall back to `npx -y` for published installs.
 */
export function resolveReadonlyStdioLauncher(params: {
  packageName: string;
  binFile: string;
}): { command: string; args: string[] } {
  try {
    const require = createRequire(import.meta.url);
    const pkgJson = require.resolve(`${params.packageName}/package.json`);
    return {
      command: process.execPath,
      args: [join(dirname(pkgJson), 'bin', params.binFile)],
    };
  } catch {
    return {
      command: 'npx',
      args: ['-y', params.packageName],
    };
  }
}

/** @deprecated Alias — same as resolveReadonlyStdioLauncher. */
export const resolveDbStdioLauncher = resolveReadonlyStdioLauncher;

/**
 * Built-in MCP server catalog (store).
 * Not installed by default — hosts add entries into `McpSettings.servers`
 * when the user opts in.
 */
export const MCP_BUILTIN_IDS = [
  'filesystem',
  'sequential-thinking',
  'memory',
  'playwright',
  'puppeteer',
  'github',
  'gitea',
  'brave-search',
  'excalidraw',
  'sqlite',
  'postgres',
  'mongo',
  'sql',
] as const;

export type McpBuiltinId = (typeof MCP_BUILTIN_IDS)[number];

export type McpCatalogCategory =
  | 'workspace'
  | 'reasoning'
  | 'browser'
  | 'vcs'
  | 'search'
  | 'diagrams'
  | 'database';

/** Secret / config field collected before one-click install. */
export interface McpCatalogSecretField {
  /** Env var written into `.mitii/mcp.json` `env`. */
  key: string;
  label: string;
  /** Mask input in the UI. */
  secret?: boolean;
  required?: boolean;
  placeholder?: string;
  hint?: string;
}

export interface McpCatalogMeta {
  id: McpBuiltinId;
  category: McpCatalogCategory;
  description: string;
  secrets: readonly McpCatalogSecretField[];
}

export const MCP_CATALOG_META: Record<McpBuiltinId, McpCatalogMeta> = {
  filesystem: {
    id: 'filesystem',
    category: 'workspace',
    description: 'Bounded filesystem tools for this workspace.',
    secrets: [],
  },
  'sequential-thinking': {
    id: 'sequential-thinking',
    category: 'reasoning',
    description: 'Structured multi-step reasoning helper.',
    secrets: [],
  },
  memory: {
    id: 'memory',
    category: 'reasoning',
    description: 'External memory tools via MCP.',
    secrets: [],
  },
  playwright: {
    id: 'playwright',
    category: 'browser',
    description: 'Browser automation via Playwright (accessibility snapshots).',
    secrets: [],
  },
  puppeteer: {
    id: 'puppeteer',
    category: 'browser',
    description: 'Browser automation via Puppeteer.',
    secrets: [],
  },
  github: {
    id: 'github',
    category: 'vcs',
    description: 'GitHub repos, issues, PRs, and code search.',
    secrets: [
      {
        key: 'GITHUB_PERSONAL_ACCESS_TOKEN',
        label: 'GitHub personal access token',
        secret: true,
        required: true,
        placeholder: 'ghp_…',
        hint: 'Classic or fine-grained PAT with repo access as needed.',
      },
    ],
  },
  gitea: {
    id: 'gitea',
    category: 'vcs',
    description: 'Self-hosted Gitea repos, issues, and pull requests.',
    secrets: [
      {
        key: 'GITEA_HOST',
        label: 'Gitea host URL',
        secret: false,
        required: true,
        placeholder: 'https://gitea.example.com',
        hint: 'Base URL of your Gitea instance (no trailing slash required).',
      },
      {
        key: 'GITEA_ACCESS_TOKEN',
        label: 'Gitea access token',
        secret: true,
        required: true,
        placeholder: 'token',
        hint: 'Create under Settings → Applications on your Gitea instance.',
      },
    ],
  },
  'brave-search': {
    id: 'brave-search',
    category: 'search',
    description: 'Web and local search via Brave Search API.',
    secrets: [
      {
        key: 'BRAVE_API_KEY',
        label: 'Brave Search API key',
        secret: true,
        required: true,
        placeholder: 'BSA…',
        hint: 'From https://brave.com/search/api/',
      },
    ],
  },
  excalidraw: {
    id: 'excalidraw',
    category: 'diagrams',
    description: 'Hand-drawn architecture diagrams (mcp.excalidraw.com).',
    secrets: [],
  },
  sqlite: {
    id: 'sqlite',
    category: 'database',
    description:
      'SQLite via @mitii/mcp-sqlite. Read-only or read/write (MCP_DB_ACCESS). Tools: list_tables, describe_table, query, execute_write.',
    secrets: [
      {
        key: 'SQLITE_PATH',
        label: 'SQLite database path',
        secret: false,
        required: true,
        placeholder: './data/app.db',
        hint: 'Absolute or workspace-relative path to the .db / .sqlite file.',
      },
    ],
  },
  postgres: {
    id: 'postgres',
    category: 'database',
    description:
      'Postgres via @mitii/mcp-postgres. Read-only or read/write (MCP_DB_ACCESS). Tools: list_tables, describe_table, query, execute_write.',
    secrets: [
      {
        key: 'MITII_DB_HOST',
        label: 'Host',
        secret: false,
        required: true,
        placeholder: 'localhost',
        hint: 'Hostname or IP of the Postgres server.',
      },
      {
        key: 'MITII_DB_PORT',
        label: 'Port',
        secret: false,
        required: false,
        placeholder: '5432',
      },
      {
        key: 'MITII_DB_USER',
        label: 'Username',
        secret: false,
        required: false,
        placeholder: 'postgres',
      },
      {
        key: 'MITII_DB_PASSWORD',
        label: 'Password',
        secret: true,
        required: false,
        placeholder: '••••••••',
      },
      {
        key: 'MITII_DB_NAME',
        label: 'Database',
        secret: false,
        required: true,
        placeholder: 'mydb',
      },
      {
        key: 'DATABASE_URI',
        label: 'Full connection URI',
        secret: true,
        required: false,
        placeholder: 'postgresql://user:pass@localhost:5432/mydb',
        hint: 'Optional. When set, overrides host/user/password/database above (prefer a least-privilege role).',
      },
    ],
  },
  mongo: {
    id: 'mongo',
    category: 'database',
    description:
      'MongoDB via @mitii/mcp-mongo. Read-only or read/write (MCP_DB_ACCESS). Tools: list/describe/query/aggregate/count + insert/update/delete/create_index.',
    secrets: [
      {
        key: 'MITII_DB_HOST',
        label: 'Host',
        secret: false,
        required: true,
        placeholder: 'localhost',
        hint: 'Hostname or IP (or Atlas cluster host).',
      },
      {
        key: 'MITII_DB_PORT',
        label: 'Port',
        secret: false,
        required: false,
        placeholder: '27017',
      },
      {
        key: 'MITII_DB_USER',
        label: 'Username',
        secret: false,
        required: false,
        placeholder: 'appUser',
      },
      {
        key: 'MITII_DB_PASSWORD',
        label: 'Password',
        secret: true,
        required: false,
        placeholder: '••••••••',
      },
      {
        key: 'MITII_DB_NAME',
        label: 'Database',
        secret: false,
        required: true,
        placeholder: 'mydb',
      },
      {
        key: 'MCP_MONGODB_URI',
        label: 'Full connection URI',
        secret: true,
        required: false,
        placeholder: 'mongodb://user:pass@localhost:27017/mydb',
        hint: 'Optional. When set, overrides fields above. Use for mongodb+srv:// Atlas URIs.',
      },
    ],
  },
  sql: {
    id: 'sql',
    category: 'database',
    description:
      'Multi-dialect SQL via @mitii/mcp-sql (Postgres/MySQL/MariaDB/SQLite). Tools: list/describe/sample/query/explain + execute_write. Access via MCP_DB_ACCESS.',
    secrets: [
      {
        key: 'SQL_MCP_DIALECT',
        label: 'Dialect',
        secret: false,
        required: true,
        placeholder: 'postgresql',
        hint: 'postgresql, mysql, mariadb, or sqlite.',
      },
      {
        key: 'MITII_DB_HOST',
        label: 'Host',
        secret: false,
        required: false,
        placeholder: 'localhost',
        hint: 'Required for network dialects (not sqlite).',
      },
      {
        key: 'MITII_DB_PORT',
        label: 'Port',
        secret: false,
        required: false,
        placeholder: '5432',
        hint: 'Defaults: 5432 (postgres), 3306 (mysql/mariadb).',
      },
      {
        key: 'MITII_DB_USER',
        label: 'Username',
        secret: false,
        required: false,
        placeholder: 'user',
      },
      {
        key: 'MITII_DB_PASSWORD',
        label: 'Password',
        secret: true,
        required: false,
        placeholder: '••••••••',
      },
      {
        key: 'MITII_DB_NAME',
        label: 'Database',
        secret: false,
        required: false,
        placeholder: 'mydb',
        hint: 'Required for network dialects.',
      },
      {
        key: 'MITII_DB_PATH',
        label: 'SQLite path',
        secret: false,
        required: false,
        placeholder: './data/app.db',
        hint: 'Required when dialect is sqlite (absolute or workspace-relative .db path).',
      },
      {
        key: 'SQL_MCP_URI',
        label: 'Full connection URI',
        secret: true,
        required: false,
        placeholder: 'postgresql://user:pass@localhost:5432/mydb',
        hint: 'Optional. When set, overrides structured fields (URI or .db path).',
      },
    ],
  },
};

/** Install-form keys that must not be written into `.mitii/mcp.json` env. */
const DB_FORM_ONLY_KEYS = new Set([
  'MITII_DB_HOST',
  'MITII_DB_PORT',
  'MITII_DB_USER',
  'MITII_DB_PASSWORD',
  'MITII_DB_NAME',
  'MITII_DB_PATH',
]);

function trimSecret(
  secrets: Record<string, string> | undefined,
  key: string,
): string {
  return secrets?.[key]?.trim() ?? '';
}

function normalizeSqlDialect(raw: string): string | null {
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

function resolvePostgresUri(
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

function resolveMongoUri(
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

function resolveSqlConnection(
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

export function getBuiltinCatalogMeta(id: McpBuiltinId): McpCatalogMeta {
  return MCP_CATALOG_META[id];
}

/** Catalog entries for the MCP store UI (never auto-merged into settings). */
export function createBuiltinMcpCatalog(
  workspaceRoot?: string,
): McpServerConfig[] {
  const fsArgs = workspaceRoot
    ? ['-y', '@modelcontextprotocol/server-filesystem', workspaceRoot]
    : ['-y', '@modelcontextprotocol/server-filesystem', '.'];

  return [
    {
      id: 'filesystem',
      name: 'Filesystem',
      transport: 'stdio',
      command: 'npx',
      args: fsArgs,
      builtin: true,
      enabled: false,
    },
    {
      id: 'sequential-thinking',
      name: 'Sequential Thinking',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-sequential-thinking'],
      builtin: true,
      enabled: false,
    },
    {
      id: 'memory',
      name: 'Memory',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-memory'],
      builtin: true,
      enabled: false,
    },
    {
      id: 'playwright',
      name: 'Playwright',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@playwright/mcp@latest'],
      builtin: true,
      enabled: false,
    },
    {
      id: 'puppeteer',
      name: 'Puppeteer',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-puppeteer'],
      builtin: true,
      enabled: false,
    },
    {
      id: 'github',
      name: 'GitHub',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-github'],
      builtin: true,
      enabled: false,
    },
    {
      id: 'gitea',
      name: 'Gitea',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', 'gitea-mcp'],
      builtin: true,
      enabled: false,
    },
    {
      id: 'brave-search',
      name: 'Brave Search',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@brave/brave-search-mcp-server', '--transport', 'stdio'],
      builtin: true,
      enabled: false,
    },
    {
      id: 'excalidraw',
      name: 'Excalidraw',
      transport: 'streamable-http',
      url: 'https://mcp.excalidraw.com',
      builtin: true,
      enabled: false,
    },
    {
      id: 'sqlite',
      name: 'SQLite',
      transport: 'stdio',
      ...resolveReadonlyStdioLauncher({
        packageName: '@mitii/mcp-sqlite',
        binFile: 'mitii-mcp-sqlite.js',
      }),
      builtin: true,
      enabled: false,
    },
    {
      id: 'postgres',
      name: 'Postgres',
      transport: 'stdio',
      ...resolveReadonlyStdioLauncher({
        packageName: '@mitii/mcp-postgres',
        binFile: 'mitii-mcp-postgres.js',
      }),
      builtin: true,
      enabled: false,
    },
    {
      id: 'mongo',
      name: 'MongoDB',
      transport: 'stdio',
      ...resolveReadonlyStdioLauncher({
        packageName: '@mitii/mcp-mongo',
        binFile: 'mitii-mcp-mongo.js',
      }),
      builtin: true,
      enabled: false,
    },
    {
      id: 'sql',
      name: 'SQL',
      transport: 'stdio',
      ...resolveReadonlyStdioLauncher({
        packageName: '@mitii/mcp-sql',
        binFile: 'mitii-mcp-sql.js',
      }),
      builtin: true,
      enabled: false,
    },
  ];
}

/** @deprecated Use createBuiltinMcpCatalog — name kept for older imports. */
export const createBuiltinMcpServers = createBuiltinMcpCatalog;

/** Map retired catalog ids onto canonical sqlite / postgres / mongo. */
export const LEGACY_DATABASE_MCP_ID_MAP: Readonly<Record<string, McpBuiltinId>> =
  {
    'sqlite-readonly': 'sqlite',
    'postgres-readonly': 'postgres',
    'mongo-readonly': 'mongo',
  };

export function migrateLegacyDatabaseMcpId(id: string): string {
  const mapped = LEGACY_DATABASE_MCP_ID_MAP[id.trim().toLowerCase()];
  return mapped ?? id;
}

export function isMcpBuiltinId(id: string | undefined): id is McpBuiltinId {
  return (
    typeof id === 'string' &&
    (MCP_BUILTIN_IDS as readonly string[]).includes(id)
  );
}

export function getBuiltinCatalogEntry(
  id: McpBuiltinId,
  workspaceRoot?: string,
): McpServerConfig {
  const entry = createBuiltinMcpCatalog(workspaceRoot).find((s) => s.id === id);
  if (!entry) {
    throw new Error(`Unknown MCP builtin: ${id}`);
  }
  return entry;
}

/** Merge user-provided secrets into a catalog entry before writing mcp.json. */
export function applyBuiltinSecrets(
  entry: McpServerConfig,
  secrets: Record<string, string> | undefined,
): McpServerConfig {
  const env = { ...(entry.env ?? {}) };
  const id = migrateLegacyDatabaseMcpId(
    (entry.id ?? entry.name).toLowerCase(),
  );
  const isDb =
    id === 'sqlite' ||
    id === 'postgres' ||
    id === 'mongo' ||
    id === 'sql';
  if (isDb && !env.MCP_DB_ACCESS) {
    env.MCP_DB_ACCESS = 'readonly';
  }

  if (id === 'postgres') {
    const uri = resolvePostgresUri(secrets);
    if (uri) env.DATABASE_URI = uri;
  } else if (id === 'mongo') {
    const uri = resolveMongoUri(secrets);
    if (uri) env.MCP_MONGODB_URI = uri;
  } else if (id === 'sql') {
    const resolved = resolveSqlConnection(secrets);
    if (resolved) {
      env.SQL_MCP_URI = resolved.uri;
      if (resolved.dialect) env.SQL_MCP_DIALECT = resolved.dialect;
    }
  } else if (secrets) {
    for (const [key, value] of Object.entries(secrets)) {
      if (DB_FORM_ONLY_KEYS.has(key)) continue;
      const trimmed = value.trim();
      if (trimmed) env[key] = trimmed;
    }
  }

  // Strip any form-only keys that may have been copied from a prior draft.
  for (const key of DB_FORM_ONLY_KEYS) {
    delete env[key];
  }

  if (Object.keys(env).length === 0) return entry;
  return { ...entry, env };
}

export function validateBuiltinSecrets(
  id: McpBuiltinId,
  secrets: Record<string, string> | undefined,
): string | null {
  if (id === 'sqlite') {
    const path = trimSecret(secrets, 'SQLITE_PATH');
    if (!path) return 'SQLite database path is required';
    return null;
  }

  if (id === 'postgres') {
    if (trimSecret(secrets, 'DATABASE_URI')) return null;
    if (!trimSecret(secrets, 'MITII_DB_HOST')) {
      return 'Host is required (or provide a Full connection URI)';
    }
    if (!trimSecret(secrets, 'MITII_DB_NAME')) {
      return 'Database is required (or provide a Full connection URI)';
    }
    return null;
  }

  if (id === 'mongo') {
    if (trimSecret(secrets, 'MCP_MONGODB_URI')) return null;
    if (!trimSecret(secrets, 'MITII_DB_HOST')) {
      return 'Host is required (or provide a Full connection URI)';
    }
    if (!trimSecret(secrets, 'MITII_DB_NAME')) {
      return 'Database is required (or provide a Full connection URI)';
    }
    return null;
  }

  if (id === 'sql') {
    if (trimSecret(secrets, 'SQL_MCP_URI')) {
      // Dialect optional when URI encodes it; still accept explicit dialect.
      const dialectRaw = trimSecret(secrets, 'SQL_MCP_DIALECT');
      if (dialectRaw && !normalizeSqlDialect(dialectRaw)) {
        return 'Dialect must be postgresql, mysql, mariadb, or sqlite';
      }
      return null;
    }
    const dialectRaw = trimSecret(secrets, 'SQL_MCP_DIALECT');
    if (!dialectRaw) {
      return 'Dialect is required (or provide a Full connection URI)';
    }
    const dialect = normalizeSqlDialect(dialectRaw);
    if (!dialect) {
      return 'Dialect must be postgresql, mysql, mariadb, or sqlite';
    }
    if (dialect === 'sqlite') {
      if (
        !trimSecret(secrets, 'MITII_DB_PATH') &&
        !trimSecret(secrets, 'SQLITE_PATH')
      ) {
        return 'SQLite path is required when dialect is sqlite';
      }
      return null;
    }
    if (!trimSecret(secrets, 'MITII_DB_HOST')) {
      return 'Host is required for network SQL dialects';
    }
    if (!trimSecret(secrets, 'MITII_DB_NAME')) {
      return 'Database is required for network SQL dialects';
    }
    return null;
  }

  const meta = getBuiltinCatalogMeta(id);
  for (const field of meta.secrets) {
    if (field.required === false) continue;
    const value = secrets?.[field.key]?.trim() ?? '';
    if (!value) return `${field.label} is required`;
  }
  return null;
}
