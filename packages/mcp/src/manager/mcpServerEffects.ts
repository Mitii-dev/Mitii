import type { McpServerConfig } from '../contracts/types.js';

/** First-party Mitii DB MCP servers — always read-only probes. */
const DATABASE_READONLY_BUILTIN_IDS = new Set([
  'sqlite-readonly',
  'postgres-readonly',
  'mongo-readonly',
]);

/** Servers / transports that do not mutate the workspace. */
export function mcpServerRequiresWorkspaceWrite(
  server: McpServerConfig,
): boolean {
  if (server.transport === 'streamable-http' || server.transport === 'sse') {
    return false;
  }
  const id = (server.id ?? server.name).toLowerCase();
  return !readOnlyMcpServer(id);
}

/** Servers known to be side-effect free (no workspace mutation). */
export function readOnlyMcpServer(serverId: string): boolean {
  const id = serverId.trim().toLowerCase();
  if (!id) return false;
  if (DATABASE_READONLY_BUILTIN_IDS.has(id)) return true;
  // Catalog / custom DB connectors: *-readonly, *read-only*, etc.
  if (id.includes('readonly') || id.includes('read-only') || id.endsWith('-ro')) {
    return true;
  }
  return (
    id === 'sequential-thinking' ||
    id === 'sequential_thinking' ||
    id.includes('thinking') ||
    id === 'excalidraw'
  );
}

export function resolveStdioArgs(
  server: McpServerConfig,
  workspaceRoot?: string,
): string[] | undefined {
  if (server.id === 'filesystem' && workspaceRoot) {
    return ['-y', '@modelcontextprotocol/server-filesystem', workspaceRoot];
  }
  return server.args;
}
