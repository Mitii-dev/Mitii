/**
 * Stable identifiers for MCP attach.
 * No provider-specific special cases — catalogs stay generic.
 */

/** Maximum MCP servers attachable per run (@mcp:, host pin). */
export const MAX_REQUIRED_MCP_SERVERS = 5;

/** Host-registered MCP tools use this stable name prefix. */
export const MCP_TOOL_NAME_PREFIX = "mcp__";

/** Leading @mcp:server_id mention in user text. */
export const MCP_MENTION_PATTERN = /@mcp:([a-z0-9][a-z0-9_-]{0,63})/gi;

export const MCP_ATTACH_STAGES = {
  normalizeServerId: "1-normalize-server-id",
  parseMentions: "2-parse-mentions",
  mergeServerIds: "3-merge-server-ids",
  matchTool: "4-match-tool",
  filterTools: "5-filter-tools",
  stampGrant: "6-stamp-grant",
  formatInstruction: "7-format-instruction",
} as const;

export type McpAttachStageName =
  (typeof MCP_ATTACH_STAGES)[keyof typeof MCP_ATTACH_STAGES];

/** Project-rule block metadata for attached MCP servers. */
export const MCP_ATTACH_INSTRUCTION = {
  id: "mcp-attach",
  title: "Attached MCP",
  priority: 20,
  body: (serverList: string) =>
    `The user attached MCP server(s) for this turn: ${serverList}. Prefer those \`mcp__{serverId}__*\` tools when they help answer the request instead of reinventing their capabilities in plain text.`,
} as const;
