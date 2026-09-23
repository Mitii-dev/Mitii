/** Build a project-rule block that steers the model toward attached MCP tools. */
export function formatMcpAttachInstruction(
  requiredMcpServerIds: readonly string[],
): {
  id: string;
  title: string;
  priority: number;
  content: string;
} | undefined {
  const ids = requiredMcpServerIds
    .map((id) => id.trim().toLowerCase())
    .filter(Boolean);
  if (ids.length === 0) return undefined;

  const list = ids.map((id) => `\`${id}\``).join(", ");
  const prefersExcalidraw = ids.includes("excalidraw");
  const diagramHint = prefersExcalidraw
    ? " For architecture / flow diagrams, call `mcp__excalidraw__create_view` (via describe_tool first if needed) instead of inventing Mermaid or ASCII art."
    : " Prefer the attached MCP tools over reinventing their capabilities in plain text.";

  return {
    id: "mcp-attach",
    title: "Attached MCP",
    priority: 20,
    content: `The user attached MCP server(s) for this turn: ${list}. Use those \`mcp__{serverId}__*\` tools when they help answer the request.${diagramHint}`,
  };
}
