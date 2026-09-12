/**
 * Stable Mitii tool name for a host-registered MCP tool.
 * Format: `mcp__{serverId}__{toolName}` (unsafe chars → `_`).
 */
export function mcpToolName(serverId: string, toolName: string): string {
  const safeServer = serverId.replace(/[^a-zA-Z0-9_-]/g, '_');
  const safeTool = toolName.replace(/[^a-zA-Z0-9_-]/g, '_');
  return `mcp__${safeServer}__${safeTool}`;
}
