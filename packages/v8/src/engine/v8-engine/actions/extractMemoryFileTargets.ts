import type { RequestUnderstandingResult } from "../../../modules/request-understanding";

/**
 * Workspace-relative file targets for Memory retrieve.
 * Mirrors skill path evidence but files only — folders do not boost facts.
 */
export function extractMemoryFileTargets(
  understanding: RequestUnderstandingResult | undefined,
): string[] {
  if (!understanding) {
    return [];
  }

  const files: string[] = [];
  for (const target of understanding.taskAnalysis.targets) {
    if (target.kind !== "file" || target.value.trim().length === 0) {
      continue;
    }
    const normalized = normalizeMemoryEvidencePath(target.value);
    if (normalized) {
      files.push(normalized);
    }
  }

  return [...new Set(files)].slice(0, 12);
}

function normalizeMemoryEvidencePath(value: string): string | undefined {
  const normalized = value
    .trim()
    .replace(/^@+/, "")
    .replace(/\\/g, "/")
    .replace(/^\.\//, "");
  if (
    !normalized ||
    normalized.includes("..") ||
    normalized.startsWith("/") ||
    normalized.startsWith("~") ||
    /^[A-Za-z]:\//.test(normalized)
  ) {
    return undefined;
  }
  return normalized;
}
