import { normalizeRelativePath } from "./impactGraphHelpers";

/**
 * Extract `apps/<name>` / `packages/<name>` style package roots, else the
 * first path segment, else undefined for root files.
 */
export function packageRootFromPath(relativePath: string): string | undefined {
  const normalized = normalizeRelativePath(relativePath);
  if (!normalized) return undefined;
  const monorepo = /^(apps|packages)\/[^/]+/.exec(normalized);
  if (monorepo?.[0]) return monorepo[0];
  const slash = normalized.indexOf("/");
  if (slash <= 0) return undefined;
  return normalized.slice(0, slash);
}

export function filenameStem(relativePath: string): string {
  const normalized = normalizeRelativePath(relativePath);
  const base = normalized.split("/").pop() ?? normalized;
  return base.replace(/\.[^.]+$/, "").toLowerCase();
}

/**
 * True when two filenames share a meaningful prefix (for example
 * `session` / `sessionStore`) used as weak sibling evidence.
 */
export function filenamesSharePrefix(
  leftPath: string,
  rightPath: string,
  minimumLength = 4,
): boolean {
  const left = filenameStem(leftPath);
  const right = filenameStem(rightPath);
  if (left.length < minimumLength || right.length < minimumLength) {
    return false;
  }
  const shorter = left.length <= right.length ? left : right;
  const longer = left.length <= right.length ? right : left;
  return longer.startsWith(shorter);
}
