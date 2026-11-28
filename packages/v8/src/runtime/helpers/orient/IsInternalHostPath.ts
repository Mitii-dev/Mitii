/**
 * Host / VCS / harness internals — never treat as user pins or product focus.
 * Single policy for orient, briefcase, and verify-repair write filters.
 */

export function isInternalHostPath(path: string): boolean {
  const normalized = path.replace(/\\/g, "/").replace(/^\.\//, "").trim();
  if (!normalized) return true;
  if (
    normalized === ".mitii" ||
    normalized.startsWith(".mitii/") ||
    normalized === ".git" ||
    normalized.startsWith(".git/") ||
    normalized === "node_modules" ||
    normalized.startsWith("node_modules/")
  ) {
    return true;
  }
  return isEphemeralWorkspacePath(normalized);
}

/**
 * Scratch / temp / debug artifacts from tests or local harnesses.
 * Matches path segments like `.scratch`, `.tmp-foo`, `.debug-bar.mjs`.
 */
export function isEphemeralWorkspacePath(path: string): boolean {
  const normalized = path.replace(/\\/g, "/").replace(/^\.\//, "").trim();
  if (!normalized) return true;
  return normalized.split("/").some((part) => {
    if (!part) return false;
    if (part === ".scratch" || part.startsWith(".scratch.")) return true;
    if (part.startsWith(".tmp-") || part.startsWith(".tmp.")) return true;
    if (part.startsWith(".debug-") || part.startsWith(".debug.")) return true;
    return false;
  });
}
