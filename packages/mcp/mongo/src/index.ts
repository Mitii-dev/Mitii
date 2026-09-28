/**
 * @mitii/mcp-mongo — stdio MCP server for MongoDB (Mitii Database mode).
 *
 * Env:
 * - MCP_MONGODB_URI or MONGODB_URI (required)
 * - MCP_DB_ACCESS=readonly|readwrite (default readonly)
 * - MONGO_MAX_DOCS (optional, default 50)
 *
 * Read tools: list_collections, describe_collection, query, aggregate, count, server_info
 * Write tools (readwrite only): insert, update, delete, create_index
 *
 * Capability set aligned with MCP-Ref/mcp-mongo-server (+ Mitii discovery ladder).
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
  resolveMongoUri,
  rejectForbiddenPipeline,
} from './tools.js';
export { runMcpMongoServer, runMcpMongoReadonlyServer } from './server.js';
