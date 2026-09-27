import {
  getBuiltinCatalogMeta,
  isMcpBuiltinId,
  readMcpSettingsFromDisk,
} from '@mitii/mcp';

import {
  DATABASE_MCP_BUILTIN_IDS,
  type DatabaseMcpBuiltinId,
} from './constants.js';
import type { DatabaseMcpServerRef } from './contracts.js';

const BUILTIN_SET = new Set<string>(DATABASE_MCP_BUILTIN_IDS);

function isDatabaseCategoryBuiltin(id: string): id is DatabaseMcpBuiltinId {
  if (!BUILTIN_SET.has(id)) return false;
  if (!isMcpBuiltinId(id)) return false;
  return getBuiltinCatalogMeta(id).category === 'database';
}

/**
 * Heuristic for custom (non-catalog) MCP servers that look like DB connectors.
 * Keep conservative — false positives would pin wrong tools in Ask.
 */
function looksLikeDatabaseServer(params: {
  id: string;
  name: string;
}): boolean {
  const hay = `${params.id} ${params.name}`.toLowerCase();
  return (
    /\b(sqlite|postgres|postgresql|mysql|mariadb|mssql|sqlserver|mongo|mongodb|neon|supabase|duckdb|redshift|snowflake|bigquery|odbc|database|db-)\b/.test(
      hay,
    ) ||
    hay.includes('sql') ||
    hay.endsWith('-db') ||
    hay.startsWith('db-')
  );
}

/**
 * List MCP servers installed in `.mitii/mcp.json` that are enabled and
 * classified as database connectors (catalog category or name heuristic).
 */
export function listInstalledDatabaseMcpServers(
  workspaceRoot: string,
): DatabaseMcpServerRef[] {
  const settings = readMcpSettingsFromDisk(workspaceRoot);
  if (!settings.enabled) return [];

  const out: DatabaseMcpServerRef[] = [];
  for (const server of settings.servers) {
    const enabled = server.enabled !== false && server.disabled !== true;
    if (!enabled) continue;
    const id = (server.id ?? server.name).trim();
    if (!id) continue;
    const name = server.name?.trim() || id;

    if (isDatabaseCategoryBuiltin(id)) {
      out.push({
        id,
        name,
        builtin: true,
        builtinId: id,
      });
      continue;
    }

    if (looksLikeDatabaseServer({ id, name })) {
      out.push({ id, name, builtin: false });
    }
  }
  return out;
}

export function listInstalledDatabaseMcpServerIds(
  workspaceRoot: string,
): string[] {
  return listInstalledDatabaseMcpServers(workspaceRoot).map((s) => s.id);
}

export function isMcpMasterEnabled(workspaceRoot: string): boolean {
  return readMcpSettingsFromDisk(workspaceRoot).enabled === true;
}
