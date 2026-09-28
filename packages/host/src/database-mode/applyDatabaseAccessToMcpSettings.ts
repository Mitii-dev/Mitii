/**
 * Stamp MCP_DB_ACCESS onto installed database MCP servers in `.mitii/mcp.json`.
 * Returns true when the file changed (caller should restart MCP / engine).
 */

import {
  readMcpSettingsFromDisk,
  writeMcpSettingsToDisk,
} from '@mitii/mcp';

import {
  DATABASE_MCP_BUILTIN_IDS,
  MCP_DB_ACCESS_ENV_KEY,
  type DatabaseDbAccess,
} from './constants.js';
import { listInstalledDatabaseMcpServers } from './listInstalledDatabaseMcpServers.js';

const BUILTIN_SET = new Set<string>(DATABASE_MCP_BUILTIN_IDS);

export function applyDatabaseAccessToMcpSettings(
  workspaceRoot: string,
  dbAccess: DatabaseDbAccess,
): { changed: boolean; serverIds: string[] } {
  const installed = listInstalledDatabaseMcpServers(workspaceRoot);
  if (installed.length === 0) {
    return { changed: false, serverIds: [] };
  }
  const targetIds = new Set(installed.map((s) => s.id));
  const mcp = readMcpSettingsFromDisk(workspaceRoot);
  let changed = false;
  const servers = mcp.servers.map((server) => {
    const id = (server.id ?? server.name).trim();
    if (!targetIds.has(id) && !BUILTIN_SET.has(id.toLowerCase())) {
      return server;
    }
    if (!targetIds.has(id)) return server;
    const prev = server.env?.[MCP_DB_ACCESS_ENV_KEY];
    if (prev === dbAccess) return server;
    changed = true;
    return {
      ...server,
      env: {
        ...(server.env ?? {}),
        [MCP_DB_ACCESS_ENV_KEY]: dbAccess,
      },
    };
  });
  if (changed) {
    writeMcpSettingsToDisk(workspaceRoot, { ...mcp, servers });
  }
  return { changed, serverIds: [...targetIds] };
}
