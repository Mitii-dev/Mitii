/**
 * @mitii/mcp-mongo-readonly — stdio MCP server for read-only MongoDB probes.
 *
 * Env:
 * - MCP_MONGODB_URI or MONGODB_URI (required) — mongodb:// or mongodb+srv://
 * - MONGO_MAX_DOCS (optional, default 50) — cap on query/aggregate docs
 *
 * Tools: list, schema, query, aggregate, count.
 * Writes and dangerous aggregation stages are always rejected.
 */

export {
  TOOL_DEFINITIONS,
  listToolDefinitions,
  handleToolCall,
  resolveMongoUri,
  rejectForbiddenPipeline,
} from './tools.js';
export { runMcpMongoReadonlyServer } from './server.js';
