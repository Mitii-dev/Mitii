/**
 * @mitii/mcp-sql — multi-dialect SQL MCP (Postgres / MySQL / MariaDB / SQLite).
 *
 * Mitii first-party stdio server for Database mode.
 *
 * Env:
 * - SQL_MCP_URI | DATABASE_URI | SQLITE_PATH (single connection)
 * - SQL_MCP_CONNECTIONS JSON array (multi connection)
 * - SQL_MCP_DIALECT=postgresql|mysql|mariadb|sqlite (optional; inferred)
 * - MCP_DB_ACCESS=readonly|readwrite (default readonly)
 * - SQL_MAX_ROWS (optional, default 50)
 *
 * Read tools: list_connections, list_tables, describe_table, list_foreign_keys,
 * sample_rows, query, explain_query, ping
 * Write tool (readwrite): execute_write
 */

export {
  resolveDbAccessMode,
  WRITE_TOOL_NAMES,
  isDbWriteToolName,
  type DbAccessMode,
} from './access.js';
export {
  inferDialectFromUri,
  resolveConnectionProfiles,
  pickConnection,
  type SqlDialect,
  type SqlConnectionProfile,
} from './connections.js';
export {
  TOOL_DEFINITIONS,
  listToolDefinitions,
  handleToolCall,
} from './tools.js';
export { rejectMutationSql, assertDmlSql } from './sqlGuard.js';
export { runMcpSqlServer } from './server.js';
