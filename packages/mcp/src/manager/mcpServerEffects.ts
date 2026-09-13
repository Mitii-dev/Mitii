import type { McpServerConfig } from '../contracts/types.js';

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
  return (
    serverId === 'sequential-thinking' ||
    serverId === 'sequential_thinking' ||
    serverId.includes('thinking') ||
    serverId === 'excalidraw'
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
