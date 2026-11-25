import { MAX_REQUIRED_MCP_SERVERS } from "../constants";
import { normalizeMcpServerId } from "./1-normalize-server-id";

/**
 * Flow step 3: merge host pins + parsed mentions (pins first), capped.
 */
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
