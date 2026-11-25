/**
 * Flow step 1: normalize a raw MCP server id (trim, lower, safe chars).
 */
export function normalizeMcpServerId(value: string): string | undefined {
  const id = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return id || undefined;
}
