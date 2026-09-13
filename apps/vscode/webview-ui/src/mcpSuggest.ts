import type { McpServerConfig } from './protocol';

export interface McpSuggestItem {
  id: string;
  name: string;
}

/** Enabled MCP servers available for `@mcp:` attach. */
export function enabledMcpSuggestItems(
  servers: readonly McpServerConfig[],
): McpSuggestItem[] {
  return servers
    .filter((server) => server.enabled !== false)
    .map((server) => ({
      id: (server.id ?? server.name).toLowerCase(),
      name: server.name,
    }))
    .filter((item) => item.id.length > 0);
}

export function filterMcpSuggestions(
  items: readonly McpSuggestItem[],
  query: string,
): McpSuggestItem[] {
  if (!query) return [...items];
  const q = query.toLowerCase();
  return items.filter(
    (item) =>
      item.id.includes(q) || item.name.toLowerCase().includes(q),
  );
}

/** Returns the partial id after `@mcp` / `@mcp:` at end of input, or null. */
export function detectMcpMentionQuery(value: string): string | null {
  const match = value.match(/@mcp:?([a-z0-9_-]*)$/i);
  if (!match) return null;
  return (match[1] ?? '').toLowerCase();
}

export function insertMcpMention(prompt: string, serverId: string): string {
  if (/@mcp:?[a-z0-9_-]*$/i.test(prompt)) {
    return prompt.replace(/@mcp:?[a-z0-9_-]*$/i, `@mcp:${serverId} `);
  }
  if (/@$/i.test(prompt)) {
    return prompt.replace(/@$/i, `@mcp:${serverId} `);
  }
  return `${prompt.trimEnd()} @mcp:${serverId} `.trimStart();
}

export const MAX_PINNED_MCP_SERVERS = 5;

export function togglePinnedMcpServer(
  pinned: readonly string[],
  serverId: string,
): string[] {
  const id = serverId.toLowerCase();
  if (pinned.includes(id)) {
    return pinned.filter((entry) => entry !== id);
  }
  if (pinned.length >= MAX_PINNED_MCP_SERVERS) {
    return [...pinned];
  }
  return [...pinned, id];
}
