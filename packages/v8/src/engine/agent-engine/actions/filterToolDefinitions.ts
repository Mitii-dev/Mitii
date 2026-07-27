import type { ToolGrant } from "../../../modules/decision-policy";
import type { ModelToolDefinition } from "../../../modules/model-gateway";

import { DEFAULT_READ_ONLY_TOOL_DEFINITIONS } from "../policy";

/** Host-registered MCP tools use this stable name prefix. */
export const MCP_TOOL_NAME_PREFIX = "mcp__";

export function isMcpToolName(name: string): boolean {
  return name.startsWith(MCP_TOOL_NAME_PREFIX);
}

/**
 * Filter tool definitions by grant. Model text cannot broaden the set.
 * Host-registered MCP tools (`mcp__*`) are only exposed when the grant already
 * allows workspace writes (Agent execute), so ask/plan stay on the built-in
 * read belt without spawning opaque MCP side effects.
 */
export function filterToolDefinitions(params: {
  grant: ToolGrant;
  definitions?: readonly ModelToolDefinition[];
  supportsTools: boolean;
}): ModelToolDefinition[] {
  if (!params.supportsTools || params.grant.allowedTools.length === 0) {
    return [];
  }

  const allowed = new Set(params.grant.allowedTools);
  const catalog = params.definitions ?? DEFAULT_READ_ONLY_TOOL_DEFINITIONS;
  const mcpWritable = params.grant.maximumWorkspaceEffect === "write";

  return catalog.filter(
    (tool) =>
      allowed.has(tool.name) || (mcpWritable && isMcpToolName(tool.name)),
  );
}
