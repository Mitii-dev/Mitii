/**
 * @mitii/mcp-sqlite-readonly — stdio MCP server for read-only SQLite probes.
 *
 * Env:
 * - SQLITE_PATH (required) — path to the SQLite database file
 * - SQLITE_MAX_ROWS (optional, default 50) — cap on query rows
 */

export {
  TOOL_DEFINITIONS,
  listToolDefinitions,
  handleToolCall,
  rejectMutationSql,
  openReadonlyDatabase,
} from './tools.js';
export { runMcpSqliteReadonlyServer } from './server.js';
