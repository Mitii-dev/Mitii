import { MCP_TOOL_NAME_PREFIX } from "../constants";

/**
 * Flow step 4: map `mcp__{serverId}__{tool}` → server id, and attach checks.
 */
export function mcpServerIdFromToolName(toolName: string): string | undefined {
  if (!toolName.startsWith(MCP_TOOL_NAME_PREFIX)) {
    return undefined;
  }
  const rest = toolName.slice(MCP_TOOL_NAME_PREFIX.length);
  const separator = rest.indexOf("__");
  if (separator <= 0) {
    return undefined;
  }
  const serverId = rest.slice(0, separator).trim().toLowerCase();
  return serverId || undefined;
}

/** When attach list is empty, all MCP tools pass (legacy “all enabled servers”). */
export function isMcpToolAttached(
  toolName: string,
  requiredMcpServerIds: readonly string[] | undefined,
): boolean {
  if (!requiredMcpServerIds || requiredMcpServerIds.length === 0) {
    return true;
  }
  const serverId = mcpServerIdFromToolName(toolName);
  if (!serverId) {
    return false;
  }
  const allowed = new Set(
    requiredMcpServerIds.map((id) => id.trim().toLowerCase()).filter(Boolean),
  );
  return allowed.has(serverId);
}
