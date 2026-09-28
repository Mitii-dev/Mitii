/**
 * @mitii/mcp-postgres — stdio MCP server for Postgres (Mitii Database mode).
 *
 * Env:
 * - DATABASE_URI (required)
 * - MCP_DB_ACCESS=readonly|readwrite (default readonly)
 * - POSTGRES_MAX_ROWS (optional, default 50)
 *
 * Write tool (readwrite): execute_write — INSERT / UPDATE / DELETE only.
 */

export {
  resolveDbAccessMode,
  WRITE_TOOL_NAMES,
  isDbWriteToolName,
  type DbAccessMode,
} from './access.js';
export {
  TOOL_DEFINITIONS,
  listToolDefinitions,
  handleToolCall,
  rejectMutationSql,
  assertDmlSql,
  resolveDatabaseUri,
} from './tools.js';
export {
  runMcpPostgresServer,
  runMcpPostgresReadonlyServer,
} from './server.js';
