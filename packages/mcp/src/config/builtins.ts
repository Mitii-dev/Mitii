import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

import type { McpServerConfig } from '../contracts/types.js';

import {
  MCP_BUILTIN_IDS,
  MCP_CATALOG_META,
  type McpBuiltinId,
  type McpCatalogCategory,
  type McpCatalogMeta,
  type McpCatalogSecretField,
} from './catalogMeta.js';
import {
  DB_FORM_ONLY_KEYS,
  composeDbConnectionUri,
  normalizeSqlDialect,
  resolveMongoUri,
  resolvePostgresUri,
  resolveSqlConnection,
  trimSecret,
} from './dbConnection.js';

export { MCP_BUILTIN_IDS, MCP_CATALOG_META, composeDbConnectionUri };
export type {
  McpBuiltinId,
  McpCatalogCategory,
  McpCatalogMeta,
  McpCatalogSecretField,
};

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
