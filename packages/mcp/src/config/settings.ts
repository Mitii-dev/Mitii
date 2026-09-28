import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { McpServerConfig, McpSettings } from '../contracts/types.js';
import {
  createBuiltinMcpCatalog,
  getBuiltinCatalogEntry,
  isMcpBuiltinId,
  migrateLegacyDatabaseMcpId,
  type McpBuiltinId,
} from './builtins.js';

export const MCP_FILE = 'mcp.json';

const CANONICAL_DB_DISPLAY_NAMES: Readonly<Record<string, string>> = {
  sqlite: 'SQLite',
  postgres: 'Postgres',
  mongo: 'MongoDB',
  sql: 'SQL',
};

/** Empty store install — MCP off until the user opts in. */
export function defaultMcpSettings(): McpSettings {
  return {
    enabled: false,
    servers: [],
  };
}

function isServerEnabled(s: Partial<McpServerConfig>): boolean {
  if (typeof s.enabled === 'boolean') return s.enabled;
  if (typeof s.disabled === 'boolean') return !s.disabled;
  return false;
}

function parseServer(entry: unknown): McpServerConfig | undefined {
  if (!entry || typeof entry !== 'object') return undefined;
  const s = entry as Record<string, unknown>;
  const name = String(s.name ?? '').trim();
  if (!name) return undefined;
  const idRaw = typeof s.id === 'string' ? s.id.trim() : '';
  const id =
    migrateLegacyDatabaseMcpId(
      idRaw ||
        name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '') ||
        `server-${Math.random().toString(36).slice(2, 8)}`,
    );
  const transport = String(s.transport ?? 'stdio');
  const enabled = isServerEnabled(s as Partial<McpServerConfig>);
  const displayName =
    CANONICAL_DB_DISPLAY_NAMES[id] &&
    (/read-?only/i.test(name) || name.toLowerCase().endsWith('(legacy)'))
      ? CANONICAL_DB_DISPLAY_NAMES[id]!
      : name;
  return {
    id,
    name: displayName,
    transport:
      transport === 'sse' ||
      transport === 'streamable-http' ||
      transport === 'stdio'
        ? transport
        : 'stdio',
    command: typeof s.command === 'string' ? s.command : undefined,
    args: Array.isArray(s.args) ? s.args.map(String) : undefined,
    cwd: typeof s.cwd === 'string' ? s.cwd : undefined,
    env:
      s.env && typeof s.env === 'object'
        ? Object.fromEntries(
            Object.entries(s.env as Record<string, unknown>).map(([k, v]) => [
              k,
              String(v),
            ]),
          )
        : undefined,
    url: typeof s.url === 'string' ? s.url : undefined,
    headers:
      s.headers && typeof s.headers === 'object'
        ? Object.fromEntries(
            Object.entries(s.headers as Record<string, unknown>).map(
              ([k, v]) => [k, String(v)],
            ),
          )
        : undefined,
    builtin: Boolean(s.builtin) || isMcpBuiltinId(id),
    enabled,
    disabled: !enabled,
  };
}

/**
 * Parse MCP settings as an explicit install list (store model).
 * Does not auto-inject builtins — users add them from the catalog.
 */
export function parseMcp(raw: unknown, workspaceRoot?: string): McpSettings {
  if (!raw || typeof raw !== 'object') {
    return defaultMcpSettings();
  }
  const obj = raw as Record<string, unknown>;

  // Legacy Claude-style { mcpServers: { name: { command, args } } }
  if (
    obj.mcpServers &&
    typeof obj.mcpServers === 'object' &&
    !Array.isArray(obj.servers)
  ) {
    const legacy = obj.mcpServers as Record<string, unknown>;
    const servers: McpServerConfig[] = [];
    for (const [name, cfg] of Object.entries(legacy)) {
      const parsed = parseServer(
        cfg && typeof cfg === 'object'
          ? { name, ...(cfg as object) }
          : { name },
      );
      if (parsed) {
        servers.push(refreshBuiltinArgs(parsed, workspaceRoot));
      }
    }
    return {
      enabled: obj.enabled === undefined ? false : Boolean(obj.enabled),
      servers,
    };
  }

  const enabled = obj.enabled === undefined ? false : Boolean(obj.enabled);
  const serversRaw = Array.isArray(obj.servers) ? obj.servers : [];
  const servers: McpServerConfig[] = [];
  for (const entry of serversRaw) {
    const parsed = parseServer(entry);
    if (parsed) {
      servers.push(refreshBuiltinArgs(parsed, workspaceRoot));
    }
  }
  return { enabled, servers };
}

/** Keep filesystem / first-party DB builtins pointed at resolvable launchers. */
function refreshBuiltinArgs(
  server: McpServerConfig,
  workspaceRoot?: string,
): McpServerConfig {
  const id = migrateLegacyDatabaseMcpId(server.id ?? '');
  if (!isMcpBuiltinId(id)) return server.id === id ? server : { ...server, id };

  if (id === 'filesystem' && workspaceRoot) {
    const catalog = getBuiltinCatalogEntry('filesystem', workspaceRoot);
    return { ...server, id, args: catalog.args, command: catalog.command };
  }

  if (
    id === 'sqlite' ||
    id === 'postgres' ||
    id === 'mongo' ||
    id === 'sql'
  ) {
    const catalog = getBuiltinCatalogEntry(id as McpBuiltinId, workspaceRoot);
    return {
      ...server,
      id,
      name: CANONICAL_DB_DISPLAY_NAMES[id] ?? server.name,
      command: catalog.command,
      args: catalog.args,
      // Preserve user secrets / overrides; fill defaults from catalog.
      env: { ...(catalog.env ?? {}), ...(server.env ?? {}) },
    };
  }

  return server.id === id ? server : { ...server, id };
}

/** Store catalog available for install (not the user's installed list). */
export function readMcpStoreCatalog(
  workspaceRoot?: string,
): McpServerConfig[] {
  return createBuiltinMcpCatalog(workspaceRoot);
}

/** Read `.mitii/mcp.json` from a workspace (CLI / ACP / daemon). */
export function readMcpSettingsFromDisk(
  workspaceRoot: string | undefined,
): McpSettings {
  if (!workspaceRoot) return defaultMcpSettings();
  const path = join(workspaceRoot, '.mitii', MCP_FILE);
  if (!existsSync(path)) return defaultMcpSettings();
  try {
    return parseMcp(JSON.parse(readFileSync(path, 'utf8')), workspaceRoot);
  } catch {
    return defaultMcpSettings();
  }
}

/** Persist MCP settings to `.mitii/mcp.json`. */
export function writeMcpSettingsToDisk(
  workspaceRoot: string,
  mcp: McpSettings,
): void {
  const normalized = parseMcp(mcp, workspaceRoot);
  const dir = join(workspaceRoot, '.mitii');
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, MCP_FILE),
    `${JSON.stringify(normalized, null, 2)}\n`,
    'utf8',
  );
}

export function activeMcpServers(mcp: McpSettings): McpServerConfig[] {
  if (!mcp.enabled) return [];
  return mcp.servers.filter((s) => isServerEnabled(s));
}
