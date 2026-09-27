/**
 * @mitii/mcp-postgres-readonly — stdio MCP server for read-only Postgres probes.
 *
 * Env:
 * - DATABASE_URI (required) — postgresql:// connection string
 * - POSTGRES_MAX_ROWS (optional, default 50) — cap on query rows
 */

export {
  TOOL_DEFINITIONS,
  listToolDefinitions,
  handleToolCall,
  rejectMutationSql,
  resolveDatabaseUri,
} from './tools.js';
export { runMcpPostgresReadonlyServer } from './server.js';
