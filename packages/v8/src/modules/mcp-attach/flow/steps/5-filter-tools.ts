import { MCP_TOOL_NAME_PREFIX } from "../../constants";
import { isMcpToolAttached } from "./4-match-tool";

/**
 * Flow step 5: drop MCP tools whose server is not in the attach list.
 * Non-MCP tools always pass.
 */
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
