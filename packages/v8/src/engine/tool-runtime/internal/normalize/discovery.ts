import { SEARCH_QUERY_ALIASES, toPositiveInt } from "./helpers";

export function normalizeReadFileArguments(
  raw: Record<string, unknown>,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...raw };

  if (
    (next.path === undefined || next.path === "") &&
    typeof next.file === "string" &&
    next.file.length > 0
  ) {
    next.path = next.file;
  }

  if (next.startLine === undefined) {
    const fromSnake =
      toPositiveInt(next.line_start) ??
      toPositiveInt(next.start_line) ??
      toPositiveInt(next.lineStart);
    if (fromSnake !== undefined) {
      next.startLine = fromSnake;
    }
  }
  if (next.endLine === undefined) {
    const fromSnake =
      toPositiveInt(next.line_end) ??
      toPositiveInt(next.end_line) ??
      toPositiveInt(next.lineEnd);
    if (fromSnake !== undefined) {
      next.endLine = fromSnake;
    }
  }
  if (next.maxLines === undefined) {
    const fromSnake =
      toPositiveInt(next.max_lines) ?? toPositiveInt(next.maxLines);
    if (fromSnake !== undefined) {
      next.maxLines = fromSnake;
    }
  }

  delete next.file;
  delete next.line_start;
  delete next.line_end;
  delete next.start_line;
  delete next.end_line;
  delete next.max_lines;
  // Drop unrecognized camel aliases that would fail .strict()
  if ("lineStart" in next && next.startLine !== undefined) {
    delete next.lineStart;
  }
  if ("lineEnd" in next && next.endLine !== undefined) {
    delete next.lineEnd;
  }

  return next;
}

/**
 * Models often send `path: "file.ts"` (singular) instead of `paths: [...]`.
 * Map common aliases onto the real schema before strict Zod validation.
 */
export function normalizeReadDiagnosticsArguments(
  raw: Record<string, unknown>,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...raw };
  const hasPaths =
    Array.isArray(next.paths) &&
    next.paths.some((entry) => typeof entry === "string" && entry.length > 0);

  if (!hasPaths) {
    const singular =
      typeof next.path === "string" && next.path.length > 0
        ? next.path
        : typeof next.file === "string" && next.file.length > 0
          ? next.file
          : undefined;
    if (singular) {
      next.paths = [singular];
    } else if (typeof next.path === "string" && next.path.length === 0) {
      // empty path → workspace-wide (omit paths)
      delete next.paths;
    }
  }

  delete next.path;
  delete next.file;
  return next;
}
export function normalizeReadGitShowArguments(
  raw: Record<string, unknown>,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...raw };
  if (
    (next.revision === undefined || next.revision === "") &&
    typeof next.rev === "string" &&
    next.rev.length > 0
  ) {
    next.revision = next.rev;
  }
  if (
    (next.revision === undefined || next.revision === "") &&
    typeof next.ref === "string" &&
    next.ref.length > 0
  ) {
    next.revision = next.ref;
  }
  delete next.rev;
  delete next.ref;
  // Models invent output caps; drop them so .strict() does not reject.
  delete next.maxBytes;
  delete next.maxLines;
  delete next.maxLength;
  delete next.head;
  delete next.tail;
  return next;
}

/**
 * Map common invented keys onto read_git_log schema before strict Zod.
 * maxResults → maxCount; singular path → paths[].
 */
export function normalizeReadGitLogArguments(
  raw: Record<string, unknown>,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...raw };

  if (next.maxCount === undefined) {
    const fromAlias =
      toPositiveInt(next.maxResults) ??
      toPositiveInt(next.max_count) ??
      toPositiveInt(next.limit) ??
      toPositiveInt(next.n);
    if (fromAlias !== undefined) {
      next.maxCount = fromAlias;
    }
  }

  const hasPaths =
    Array.isArray(next.paths) &&
    next.paths.some((entry) => typeof entry === "string" && entry.length > 0);
  if (!hasPaths) {
    const singular =
      typeof next.path === "string" && next.path.length > 0
        ? next.path
        : typeof next.file === "string" && next.file.length > 0
          ? next.file
          : undefined;
    if (singular) {
      next.paths = [singular];
    }
  }

  delete next.maxResults;
  delete next.max_count;
  delete next.limit;
  delete next.n;
  delete next.path;
  delete next.file;
  return next;
}
export function normalizeSearchFilesArguments(
  raw: Record<string, unknown>,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...raw };

  if (
    (next.query === undefined || next.query === "") &&
    typeof next.pattern === "string" &&
    next.pattern.length > 0
  ) {
    next.query = next.pattern;
  }
  for (const alias of SEARCH_QUERY_ALIASES) {
    if (alias === "pattern") continue;
    if (
      (next.query === undefined || next.query === "") &&
      typeof next[alias] === "string" &&
      (next[alias] as string).length > 0
    ) {
      next.query = next[alias];
    }
  }

  // ripgrep-style / Cursor Grep aliases — drop after mapping
  delete next.pattern;
  delete next.output_mode;
  delete next.outputMode;
  delete next.glob;
  delete next.type;
  delete next.head_limit;
  delete next.headLimit;

  if (typeof next.max_matches === "string" || typeof next.max_matches === "number") {
    if (next.maxMatches === undefined) {
      next.maxMatches = next.max_matches;
    }
    delete next.max_matches;
  }

  if (typeof next.maxMatches === "string") {
    const parsed = Number(next.maxMatches.trim());
    if (Number.isFinite(parsed)) {
      next.maxMatches = parsed;
    }
  }

  if (next.case_sensitive !== undefined && next.caseSensitive === undefined) {
    next.caseSensitive = next.case_sensitive;
    delete next.case_sensitive;
  }

  // Explicit empty path fails min(1); treat as workspace-wide default.
  if (typeof next.path === "string" && next.path.trim().length === 0) {
    delete next.path;
  }

  // Models invent modes like "filename" / "files" — map onto the real enum.
  if (typeof next.mode === "string") {
    const mode = next.mode.trim().toLowerCase();
    if (mode === "filename" || mode === "files" || mode === "name") {
      next.mode = "literal";
    } else if (mode === "regexp" || mode === "re") {
      next.mode = "regex";
    } else if (
      mode !== "auto" &&
      mode !== "literal" &&
      mode !== "regex"
    ) {
      delete next.mode;
    }
  }

  return next;
}

export function normalizeGlobFilesArguments(
  raw: Record<string, unknown>,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...raw };
  if (
    (next.pattern === undefined || next.pattern === "") &&
    typeof next.glob === "string" &&
    next.glob.length > 0
  ) {
    next.pattern = next.glob;
  }
  delete next.glob;
  return next;
}
