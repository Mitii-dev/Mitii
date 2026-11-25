import { MCP_ATTACH_INSTRUCTION } from "../constants";
import type { McpAttachInstruction } from "../contracts";

/**
 * Flow step 7: build a project-rule block that steers toward attached MCP tools.
 * Generic — no hard-coded provider / tool names.
 */
export function formatMcpAttachInstruction(
  requiredMcpServerIds: readonly string[],
): McpAttachInstruction | undefined {
  const ids = requiredMcpServerIds
    .map((id) => id.trim().toLowerCase())
    .filter(Boolean);
  if (ids.length === 0) return undefined;

  const list = ids.map((id) => `\`${id}\``).join(", ");

  return {
    id: MCP_ATTACH_INSTRUCTION.id,
    title: MCP_ATTACH_INSTRUCTION.title,
    priority: MCP_ATTACH_INSTRUCTION.priority,
    content: MCP_ATTACH_INSTRUCTION.body(list),
  };
}
