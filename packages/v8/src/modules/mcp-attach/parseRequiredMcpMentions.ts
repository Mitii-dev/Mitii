import { MAX_REQUIRED_MCP_SERVERS } from "./constants.js";

const MCP_MENTION_PATTERN = /@mcp:([a-z0-9][a-z0-9_-]{0,63})/gi;

export function normalizeMcpServerId(value: string): string | undefined {
  const id = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return id || undefined;
}

export function parseRequiredMcpMentions(message: string): {
  cleanedMessage: string;
  requiredMcpServerIds: string[];
} {
  const ids: string[] = [];
  const seen = new Set<string>();

  const addId = (raw: string | undefined) => {
    const id = raw ? normalizeMcpServerId(raw) : undefined;
    if (!id || seen.has(id)) {
      return;
    }
    seen.add(id);
    ids.push(id);
  };

  message.replace(MCP_MENTION_PATTERN, (_match, raw: string) => {
    addId(raw);
    return " ";
  });

  const cleanedMessage = message
    .replace(MCP_MENTION_PATTERN, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();

  return {
    cleanedMessage,
    requiredMcpServerIds: ids.slice(0, MAX_REQUIRED_MCP_SERVERS),
  };
}

export function mergeRequiredMcpServerIds(
  explicit: readonly string[] | undefined,
  fromMessage: readonly string[],
): string[] {
  const merged: string[] = [];
  const seen = new Set<string>();

  for (const raw of [...(explicit ?? []), ...fromMessage]) {
    const id = normalizeMcpServerId(raw);
    if (!id || seen.has(id)) {
      continue;
    }
    seen.add(id);
    merged.push(id);
    if (merged.length >= MAX_REQUIRED_MCP_SERVERS) {
      break;
    }
  }

  return merged;
}
