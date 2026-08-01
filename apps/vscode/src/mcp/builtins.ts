import type { McpServerConfig } from '../protocol.js';

/**
 * Built-in MCP server catalog (store).
 * Not installed by default — hosts add entries into `McpSettings.servers`
 * when the user opts in.
 */
export const MCP_BUILTIN_IDS = [
  'filesystem',
  'sequential-thinking',
  'memory',
  'puppeteer',
] as const;

export type McpBuiltinId = (typeof MCP_BUILTIN_IDS)[number];

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
      id: 'puppeteer',
      name: 'Puppeteer',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-puppeteer'],
      builtin: true,
      enabled: false,
    },
  ];
}

/** @deprecated Use createBuiltinMcpCatalog — name kept for older imports. */
export const createBuiltinMcpServers = createBuiltinMcpCatalog;

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
