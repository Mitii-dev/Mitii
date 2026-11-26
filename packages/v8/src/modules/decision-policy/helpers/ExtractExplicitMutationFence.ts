/**
 * Explicit edit-limit detection for ScopeVerdict.mutationFence (§4.3).
 * Folder/file mentions alone never produce a fence — only prose limits.
 */

const EXPLICIT_LIMIT =
  /\b(?:only\s+(?:modify|change|edit|touch|fix|update)|limit\s+changes\s+to|restrict\s+changes\s+to|edits?\s+only\s+(?:in|under|inside|within)|only\s+(?:in|under|inside|within))\b/i;

const ONLY_UNDER =
  /\b(?:only\s+under|only\s+inside|only\s+within|under\s+[^\s]+(?:\s+[^\s]+){0,6}\s+only)\b/i;

const PATH_TOKEN =
  /(?:@)?((?:[\w.@+-]+\/)+[\w.@+-]+(?:\.[\w.+-]+)?|[\w.@+-]+\.[\w.+-]+)/g;

function normalizeScopePath(value: string): string {
  let normalized =
    value.replace(/\\/g, "/").replace(/^@/, "").replace(/^\.?\//, "").replace(/\/+$/, "") ||
    ".";
  if (/^github\//i.test(normalized) || normalized === "github") {
    normalized =
      normalized === "github"
        ? ".github"
        : `.github/${normalized.slice("github/".length)}`;
  }
  return normalized;
}

function parentDirectoryScope(filePath: string): string {
  const normalized = normalizeScopePath(filePath);
  if (!normalized.includes(".") || normalized.endsWith("/")) {
    return normalized;
  }
  const slash = normalized.lastIndexOf("/");
  if (slash <= 0) {
    return ".";
  }
  // File path → parent folder as fence root.
  if (/\.[\w.+-]+$/.test(normalized)) {
    return normalized.slice(0, slash);
  }
  return normalized;
}

/** True when the message explicitly limits where edits may land. */
export function hasExplicitEditLimit(message: string): boolean {
  return EXPLICIT_LIMIT.test(message) || ONLY_UNDER.test(message);
}

/**
 * Paths to fence mutations to — only when an explicit edit limit is present.
 * Returns undefined when mentions are focus-only (default).
 */
export function extractExplicitMutationFence(
  message: string,
  focusPaths: readonly string[] = [],
): string[] | undefined {
  if (!hasExplicitEditLimit(message)) {
    return undefined;
  }

  const fromMessage = new Set<string>();
  for (const match of message.matchAll(PATH_TOKEN)) {
    const raw = match[1];
    if (!raw) continue;
    fromMessage.add(parentDirectoryScope(raw));
  }

  for (const focus of focusPaths) {
    if (focus.length === 0) continue;
    fromMessage.add(parentDirectoryScope(focus));
  }

  if (fromMessage.size === 0) {
    return undefined;
  }

  return [...fromMessage].sort((a, b) => a.localeCompare(b));
}
