import { MCP_TOOL_NAME_PREFIX } from "./constants.js";

/**
 * Extract server id from `mcp__{serverId}__{toolName}`.
 * Returns undefined for non-MCP names or malformed prefixes.
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

export function filterToolsByMcpAttach<T extends { name: string }>(
  tools: readonly T[],
  requiredMcpServerIds: readonly string[] | undefined,
): T[] {
  if (!requiredMcpServerIds || requiredMcpServerIds.length === 0) {
    return [...tools];
  }
  return tools.filter((tool) => {
    if (!tool.name.startsWith(MCP_TOOL_NAME_PREFIX)) {
      return true;
    }
    return isMcpToolAttached(tool.name, requiredMcpServerIds);
  });
}

/** Stamp attach list onto a grant for ValidateGrant / describe_tool parity. */
export function withMcpAttachOnGrant<T extends { allowedMcpServerIds?: string[] }>(
  grant: T,
  requiredMcpServerIds: readonly string[] | undefined,
): T {
  if (!requiredMcpServerIds || requiredMcpServerIds.length === 0) {
    return grant;
  }
  return {
    ...grant,
    allowedMcpServerIds: [...requiredMcpServerIds],
  };
}
