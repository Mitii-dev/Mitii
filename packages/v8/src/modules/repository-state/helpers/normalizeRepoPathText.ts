/**
 * Lenient normalization for repo-relative path text that arrives from models,
 * users, tool output, and plans. Never throws and never touches the file
 * system; use `PathNormalizer` when containment must be enforced.
 */
export interface NormalizeRepoPathTextOptions {
  /** Drop leading `@` mentions (editor-style `@src/foo.ts`). Default false. */
  readonly stripAtPrefix?: boolean;
  /** Value returned when the normalized path is empty. Default `""`. */
  readonly emptyFallback?: string;
}

export function normalizeRepoPathText(
  value: string,
  options: NormalizeRepoPathTextOptions = {},
): string {
  let text = value.trim();
  if (options.stripAtPrefix === true) {
    text = text.replace(/^@+/, "");
  }
  const normalized = text
    .replace(/\\/g, "/")
    .replace(/\/+/g, "/")
    .replace(/^\.\//, "")
    .replace(/\/+$/, "");
  return normalized || (options.emptyFallback ?? "");
}
