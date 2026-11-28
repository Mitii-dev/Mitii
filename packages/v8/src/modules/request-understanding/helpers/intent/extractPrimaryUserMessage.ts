/**
 * Host adapters (e.g. VS Code) may wrap the real user ask with large
 * untrusted context blocks (repo map, git diff, pinned files). Intent
 * classification and retrieval queries must use the primary ask only.
 */
export const MITII_USER_MESSAGE_MARKER = "<<<MITII_USER_MESSAGE>>>";
export const MITII_HOST_CONTEXT_MARKER = "<<<MITII_HOST_CONTEXT>>>";

/** Known host-context section prefixes used before markers existed. */
const LEGACY_HOST_PREFIXES = [
  "Workspace file map (",
  "Workspace memories:",
  "Git status:",
  "Pinned file contents:",
  "Pinned context:",
  "[depth:",
] as const;

/**
 * Returns the primary user ask, stripping host-injected context wrappers.
 */
export function extractPrimaryUserMessage(message: string): string {
  const text = message.trim();
  if (!text) return "";

  const userIdx = text.indexOf(MITII_USER_MESSAGE_MARKER);
  if (userIdx >= 0) {
    const after = text
      .slice(userIdx + MITII_USER_MESSAGE_MARKER.length)
      .trimStart();
    const hostIdx = after.indexOf(MITII_HOST_CONTEXT_MARKER);
    const primary = (hostIdx >= 0 ? after.slice(0, hostIdx) : after).trim();
    if (primary) return primary;
  }

  // Legacy composed prompts put host blocks first and the ask last.
  if (LEGACY_HOST_PREFIXES.some((prefix) => text.startsWith(prefix))) {
    const blocks = text.split(/\n\n+/);
    for (let i = blocks.length - 1; i >= 0; i -= 1) {
      const block = blocks[i]?.trim() ?? "";
      if (!block) continue;
      if (LEGACY_HOST_PREFIXES.some((prefix) => block.startsWith(prefix))) {
        continue;
      }
      if (block.startsWith("Pinned file @")) continue;
      if (block.startsWith("Changed files:")) continue;
      if (block.startsWith("Diff stat:")) continue;
      return block;
    }
  }

  return text;
}

/**
 * Marker written by amendMessageWithPriorConversation. Task analysis must use
 * only the live ask so prior-turn file paths do not become explicit targets /
 * pathScopes (which then reject search_files/glob/list outside those files).
 */
export const CURRENT_USER_REQUEST_MARKER = "Current user request:";

/**
 * Returns the live user ask for task/target analysis when understanding was
 * amended with prior conversation for intent routing.
 */
export function extractCurrentUserRequestForAnalysis(message: string): string {
  const primary = extractPrimaryUserMessage(message);
  if (!primary) return "";

  const markerIdx = primary.lastIndexOf(CURRENT_USER_REQUEST_MARKER);
  if (markerIdx < 0) {
    return primary;
  }

  return primary
    .slice(markerIdx + CURRENT_USER_REQUEST_MARKER.length)
    .trim();
}
