import { normalizeRelativePath } from "./PathContainment";

/**
 * Canonical form for mutation path authorize/deny (Phase 6).
 * - Strip chat `@` mentions
 * - Normalize slashes / `.` / `..` via `normalizeRelativePath`
 * - Rewrite `github/…` → `.github/…` (no parallel github/ tree)
 */
export function canonicalizeMutationPath(relativePath: string): string {
  let value = relativePath.replace(/\\/g, "/").trim();
  value = value.replace(/^@(?=[A-Za-z0-9_.-])/, "");
  if (/^github\//i.test(value)) {
    value = `.github/${value.slice("github/".length)}`;
  }
  return normalizeRelativePath(value);
}

/**
 * Soft CI/github rewrite for argument normalizers (does not throw on escapes).
 */
export function normalizeCiWorkflowPath(value: string): string {
  const trimmed = value.replace(/\\/g, "/").trim();
  if (/^github\//i.test(trimmed)) {
    return `.github/${trimmed.slice("github/".length)}`;
  }
  return trimmed;
}
