/** Canonical path form for critic scope checks (`github/` → `.github/`). */

export function normalizeRepoPath(value: string): string {
  const trimmed = value.trim().replace(/\\/g, "/").replace(/^\.\//, "");
  if (/^github\/workflows\//i.test(trimmed)) {
    return `.github/${trimmed.slice("github/".length)}`;
  }
  return trimmed;
}
