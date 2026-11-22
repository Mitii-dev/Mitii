import type { McpServerConfig } from '../contracts/types.js';

/** First-party Mitii DB MCP catalog ids. */
const DATABASE_MCP_BUILTIN_IDS = new Set([
  'sqlite',
  'postgres',
  'mongo',
  'sql',
]);

/** Tool names that mutate the database (not the workspace). */
const DB_WRITE_TOOL_NAMES = new Set([
  'insert',
  'update',
  'delete',
  'create_index',
  'createindex',
  'execute_write',
]);

/**
 * True when an MCP tool name is a DB mutation (insert/update/delete/…).
 * Used so mixed access DB servers can expose read tools on Ask grants while
 * write tools still require a write grant.
 */
export function isMcpDbWriteToolName(toolName: string): boolean {
  const name = toolName.trim().toLowerCase();
  if (!name) return false;
  // Strip mcp__server__ prefix if present
  const bare = name.includes('__') ? name.split('__').pop()! : name;
  return DB_WRITE_TOOL_NAMES.has(bare);
}

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

/** Servers known to be side-effect free for the *workspace* (DB writes are per-tool). */
export function readOnlyMcpServer(serverId: string): boolean {
  const id = serverId.trim().toLowerCase();
  if (!id) return false;
  // Canonical DB ids don't mutate the workspace tree (DB writes are per-tool).
  if (DATABASE_MCP_BUILTIN_IDS.has(id)) return true;
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
