/**
 * Detect a leading slash command token.
 * Excludes code comments (`//`, `/*`).
 */
export function isLeadingSlashCommand(text: string): boolean {
  if (!text.startsWith("/")) {
    return false;
  }
  if (text.startsWith("//") || text.startsWith("/*")) {
    return false;
  }
  return true;
}

export interface ParsedLeadingCommand {
  name: string;
  args: string;
  /** Full matched prefix including leading `/` and optional args separator. */
  matchedPrefix: string;
}

/**
 * Parse the first `/name args…` token from sanitized text.
 * Multi-word names are not supported — first whitespace splits args.
 */
export function parseLeadingCommand(
  text: string,
): ParsedLeadingCommand | undefined {
  if (!isLeadingSlashCommand(text)) {
    return undefined;
  }

  const match = /^\/([A-Za-z][A-Za-z0-9_-]*)(?:\s+(.*))?$/s.exec(text);
  if (!match) {
    return undefined;
  }

  const name = (match[1] ?? "").toLowerCase();
  const args = (match[2] ?? "").trim();
  const matchedPrefix = args.length > 0 ? `/${name} ${args}` : `/${name}`;

  return {
    name,
    args,
    matchedPrefix: text.startsWith(matchedPrefix)
      ? matchedPrefix
      : text.slice(0, matchedPrefix.length),
  };
}
