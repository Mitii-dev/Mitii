/**
 * @mitii/mcp-web — stdio MCP server over @mitii/search-kit.
 *
 * Depends on search-kit only (not v8/sdk/host). Optional memory_search is
 * opt-in via MITII_MCP_WEB_MEMORY=1 (soft-parse facts.json; shareable only).
 */

export {
  TOOL_DEFINITIONS,
  listToolDefinitions,
  handleToolCall,
} from './tools.js';
export { runMcpWebServer } from './server.js';
