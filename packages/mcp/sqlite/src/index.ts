/**
 * @mitii/mcp-sqlite — stdio MCP server for SQLite (Mitii Database mode).
 *
 * Env:
 * - SQLITE_PATH (required)
 * - MCP_DB_ACCESS=readonly|readwrite (default readonly)
 * - SQLITE_MAX_ROWS (optional, default 50)
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
  openReadonlyDatabase,
  openWritableDatabase,
} from './tools.js';
export { runMcpSqliteServer, runMcpSqliteReadonlyServer } from './server.js';
