import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type * as vscode from 'vscode';

import {
  createBuiltinMcpCatalog,
  getBuiltinCatalogEntry,
  isMcpBuiltinId,
} from './mcp/builtins.js';
import type { McpServerConfig, McpSettings } from './protocol.js';

const MCP_FILE = 'mcp.json';

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
    idRaw ||
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') ||
    `server-${Math.random().toString(36).slice(2, 8)}`;
  const transport = String(s.transport ?? 'stdio');
  const enabled = isServerEnabled(s as Partial<McpServerConfig>);
  return {
    id,
    name,
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

/** Keep filesystem builtin rooted at the current workspace when installed. */
function refreshBuiltinArgs(
  server: McpServerConfig,
  workspaceRoot?: string,
): McpServerConfig {
  if (server.id === 'filesystem' && workspaceRoot && isMcpBuiltinId(server.id)) {
    const catalog = getBuiltinCatalogEntry('filesystem', workspaceRoot);
    return { ...server, args: catalog.args, command: catalog.command };
  }
  return server;
}

/** Store catalog available for install (not the user's installed list). */
export function readMcpStoreCatalog(
  workspaceRoot?: string,
): McpServerConfig[] {
  return createBuiltinMcpCatalog(workspaceRoot);
}

export function readMcpSettings(
  vs: typeof vscode,
  workspaceRoot: string | undefined,
): McpSettings {
  const cfg = vs.workspace.getConfiguration('mitii');
  const fromSettings = cfg.get<McpSettings>('mcp');
  if (
    fromSettings &&
    typeof fromSettings === 'object' &&
    (Array.isArray((fromSettings as McpSettings).servers) ||
      (fromSettings as { mcpServers?: unknown }).mcpServers ||
      typeof (fromSettings as McpSettings).enabled === 'boolean')
  ) {
    return parseMcp(fromSettings, workspaceRoot);
  }
  if (workspaceRoot) {
    const path = join(workspaceRoot, '.mitii', MCP_FILE);
    if (existsSync(path)) {
      try {
        return parseMcp(JSON.parse(readFileSync(path, 'utf8')), workspaceRoot);
      } catch {
        return defaultMcpSettings();
      }
    }
  }
  return defaultMcpSettings();
}

export async function writeMcpSettings(
  vs: typeof vscode,
  workspaceRoot: string | undefined,
  mcp: McpSettings,
): Promise<void> {
  const normalized = parseMcp(mcp, workspaceRoot);
  await vs.workspace
    .getConfiguration('mitii')
    .update('mcp', normalized, vs.ConfigurationTarget.Workspace);
  if (workspaceRoot) {
    const dir = join(workspaceRoot, '.mitii');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, MCP_FILE),
      `${JSON.stringify(normalized, null, 2)}\n`,
      'utf8',
    );
  }
}

export function activeMcpServers(mcp: McpSettings): McpServerConfig[] {
  if (!mcp.enabled) return [];
  return mcp.servers.filter((s) => isServerEnabled(s));
}
