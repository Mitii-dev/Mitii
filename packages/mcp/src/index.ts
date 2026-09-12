/**
 * `@mitii/mcp` — Mitii MCP **client** kit.
 *
 * Connects to external MCP servers and registers their tools into V8
 * ToolRegistry as `mcp__{server}__{tool}`. Does not run the agent loop
 * and never widens Decision Policy grants.
 *
 * Layout: contracts / config / transports / manager
 */

export type {
  McpTransport,
  McpServerConfig,
  McpSettings,
  McpToolDescriptor,
  McpRoot,
  McpToolCallResult,
  McpClient,
  McpServerRuntimeStatus,
  McpServerStatus,
} from './contracts/index.js';

export {
  MCP_BUILTIN_IDS,
  createBuiltinMcpCatalog,
  createBuiltinMcpServers,
  isMcpBuiltinId,
  getBuiltinCatalogEntry,
  type McpBuiltinId,
  MCP_FILE,
  defaultMcpSettings,
  parseMcp,
  readMcpStoreCatalog,
  readMcpSettingsFromDisk,
  writeMcpSettingsToDisk,
  activeMcpServers,
} from './config/index.js';

export {
  McpStdioClient,
  workspaceRootsFromPath,
  createLineReader,
  McpSseClient,
  McpStreamableHttpClient,
} from './transports/index.js';

export {
  McpManager,
  getSharedMcpManager,
  resetSharedMcpManager,
  mcpToolName,
  type McpManagerSnapshot,
  type McpManagerOptions,
} from './manager/index.js';
