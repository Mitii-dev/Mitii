import { pathMatchesFolderPrefix } from "../../../modules/repository-context";
import type { RequestUnderstandingResult } from "../../../modules/request-understanding";

export const CONTEXT_READY_WARNING_CODES = new Set([
  "optional_source_unavailable",
  "required_source_unavailable",
  "file_map_fallback",
  "state_degraded",
  "source_failed",
  // A user-pinned/referenced file was dropped by budget allocation — the
  // single most user-visible context bug class, so it stays at "standard".
  "required_reference_omitted",
]);

/**
 * Lower-severity, higher-frequency context-selection drop reasons. These are
 * genuinely useful for deep debugging but noisy on every run, so they only
 * surface at logVerbosity "verbose".
 */
export const CONTEXT_READY_VERBOSE_WARNING_CODES = new Set([
  "token_budget_reached",
  "item_limit_reached",
  "file_limit_reached",
  "per_file_limit_reached",
  "representation_downgraded",
  "unknown_token_estimate",
  "excluded_path_removed",
  "duplicate_reference_removed",
]);

/**
 * Collapse `@`, `./`, empty, and `.` segments into a workspace-relative path
 * the repository-context schema will accept. Drop absolute / `..` values.
 */
export function toCanonicalWorkspaceRelativePath(
  value: string,
): string | undefined {
  const trimmed = value
    .replace(/\\/g, "/")
    .replace(/^@+/, "")
    .trim();
  if (
    !trimmed ||
    trimmed.startsWith("/") ||
    trimmed.startsWith("~") ||
    /^[A-Za-z]:\//.test(trimmed)
  ) {
    return undefined;
  }

  const segments: string[] = [];
  for (const segment of trimmed.split("/")) {
    if (!segment || segment === ".") {
      continue;
    }
    if (segment === "..") {
      return undefined;
    }
    segments.push(segment);
  }

  return segments.length > 0 ? segments.join("/") : undefined;
}

export function looksLikeContextFilePath(path: string): boolean {
  const lastSegment = path.split("/").at(-1) ?? "";
  if (!lastSegment) {
    return false;
  }
  if (lastSegment.startsWith(".") && lastSegment.length > 1) {
    return true;
  }
  return lastSegment.includes(".") && !lastSegment.endsWith(".");
}

export function scopeDiscoveredContextPaths(
  paths: readonly string[],
  focus: {
    folderPrefix?: string;
    filePaths: readonly string[];
  },
): string[] {
  const unique = [...new Set(paths.map((path) => path.trim()).filter(Boolean))];
  if (!focus.folderPrefix && focus.filePaths.length === 0) {
    return unique.slice(0, 12);
  }
  const allowedFiles = new Set(focus.filePaths);
  return unique
    .filter(
      (path) =>
        allowedFiles.has(path) ||
        (focus.folderPrefix
          ? pathMatchesFolderPrefix(path, focus.folderPrefix)
          : false),
    )
    .slice(0, 12);
}

/**
 * Map understanding targets into repository-context filters so @packages /
 * symbols / explicit files steer retrieval instead of only the raw query text.
 */
export function deriveContextFocusFromUnderstanding(
  understanding: RequestUnderstandingResult,
): {
  folderPrefix?: string;
  filePaths: string[];
  kinds: Array<"code_symbol" | "code_region" | "markdown_section" | "text">;
  references?: {
    explicitFiles: Array<{ relativePath: string }>;
  };
} {
  const filePaths: string[] = [];
  const folderPrefixes: string[] = [];
  const hasSymbol = understanding.taskAnalysis.targets.some(
    (target) => target.explicit && target.kind === "symbol",
  );

  for (const target of understanding.taskAnalysis.targets) {
    if (target.value.length === 0) {
      continue;
    }
    // Include pinned/artifact paths (explicit:false) so @apps/docs / @packages
    // steer retrieval even when they were not typed as plain folder refs.
    if (target.kind !== "file" && target.kind !== "folder") {
      continue;
    }
    // Classifiers copy diagnostic strings as-is (`./src/a.ts`). Collapse those
    // to the same canonical form the context pipeline schema requires, rather
    // than depending on the model to emit workspace-relative paths.
    const value = toCanonicalWorkspaceRelativePath(target.value);
    if (!value) {
      continue;
    }
    if (target.kind === "file" && looksLikeContextFilePath(value)) {
      filePaths.push(value);
    } else {
      folderPrefixes.push(value);
    }
  }

  const kinds: Array<
    "code_symbol" | "code_region" | "markdown_section" | "text"
  > = hasSymbol ? ["code_symbol", "code_region"] : [];

  const uniqueFolders = [...new Set(folderPrefixes)];
  // Prefer the most specific (longest) folder when several were mentioned.
  const preferredFolder = [...uniqueFolders].sort(
    (a, b) => b.length - a.length || a.localeCompare(b),
  )[0];
  const uniqueFiles = [...new Set(filePaths)].slice(0, 12);

  return {
    ...(preferredFolder ? { folderPrefix: preferredFolder } : {}),
    filePaths: uniqueFiles,
    kinds,
    ...(uniqueFiles.length > 0
      ? {
          references: {
            explicitFiles: uniqueFiles.slice(0, 8).map((relativePath) => ({
              relativePath,
            })),
          },
        }
      : {}),
  };
}
