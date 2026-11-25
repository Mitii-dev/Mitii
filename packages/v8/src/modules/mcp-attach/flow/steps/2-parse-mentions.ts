import {
  MAX_REQUIRED_MCP_SERVERS,
  MCP_MENTION_PATTERN,
} from "../../constants";
import { normalizeMcpServerId } from "./1-normalize-server-id";

export type ParseRequiredMcpMentionsResult = {
  cleanedMessage: string;
  requiredMcpServerIds: string[];
};

/**
 * Flow step 2: extract `@mcp:id` mentions and strip them from the message.
 */
export function parseRequiredMcpMentions(
  message: string,
): ParseRequiredMcpMentionsResult {
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
