/**
 * Normalize common model mis-encodings before Zod validation.
 * Restrict-only: aliases map onto the real schema; never invents tools/grants.
 *
 * Observed in AnythingLLM Mitii logs:
 * - search_files: `pattern` instead of `query`; string `maxMatches`
 * - run_readonly_command / run_command: `command` instead of `argv`
 */

const SEARCH_QUERY_ALIASES = ["pattern", "regex", "q", "text", "needle"] as const;
const COMMAND_ALIASES = ["command", "cmd", "shell"] as const;

export function normalizeCommonToolArguments(
  toolName: string,
  value: unknown,
): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }

  if (toolName === "search_files") {
    return normalizeSearchFilesArguments(value as Record<string, unknown>);
  }

  if (toolName === "run_readonly_command" || toolName === "run_command") {
    return normalizeArgvCommandArguments(value as Record<string, unknown>);
  }

  if (toolName === "glob_files") {
    return normalizeGlobFilesArguments(value as Record<string, unknown>);
  }

  if (toolName === "emit_review_finding") {
    return normalizeEmitReviewFindingArguments(value as Record<string, unknown>);
  }

  if (toolName === "read_git_show") {
    return normalizeReadGitShowArguments(value as Record<string, unknown>);
  }

  if (toolName === "read_diagnostics") {
    return normalizeReadDiagnosticsArguments(value as Record<string, unknown>);
  }

  if (toolName === "read_file" || toolName === "read_many_files") {
    return normalizeReadFileArguments(value as Record<string, unknown>);
  }

  if (toolName === "analyze_change_impact") {
    return normalizeAnalyzeChangeImpactArguments(
      value as Record<string, unknown>,
    );
  }

  return value;
}

/**
 * Models often send snake_case line ranges (line_start / line_end) or omit a
 * usable path. Map onto the camelCase schema before strict Zod validation.
 */
function normalizeReadFileArguments(
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
function normalizeReadDiagnosticsArguments(
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

function normalizeEmitReviewFindingArguments(
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

  if (
    next.content === undefined ||
    next.content === "" ||
    typeof next.content !== "string"
  ) {
    const fromTitle =
      typeof next.title === "string" && next.title.length > 0
        ? next.title
        : undefined;
    const fromDescription =
      typeof next.description === "string" && next.description.length > 0
        ? next.description
        : undefined;
    const fromMessage =
      typeof next.message === "string" && next.message.length > 0
        ? next.message
        : undefined;
    const fromBody =
      typeof next.body === "string" && next.body.length > 0
        ? next.body
        : undefined;
    const parts = [fromTitle, fromDescription ?? fromMessage ?? fromBody].filter(
      Boolean,
    ) as string[];
    if (parts.length > 0) {
      next.content = parts.join(": ");
    }
  }

  if (
    next.existingCode === undefined ||
    next.existingCode === "" ||
    typeof next.existingCode !== "string"
  ) {
    const fromAnchor =
      typeof next.existing_code === "string"
        ? next.existing_code
        : typeof next.anchor === "string"
          ? next.anchor
          : typeof next.code === "string"
            ? next.code
            : undefined;
    if (fromAnchor && fromAnchor.length > 0) {
      next.existingCode = fromAnchor;
    } else if (typeof next.content === "string" && next.content.length > 0) {
      // Keep Zod happy; anchoring may still fail later and mark unanchored.
      next.existingCode = next.content.slice(0, 240);
    }
  }

  if (next.startLine === undefined && next.line !== undefined) {
    const line = toPositiveInt(next.line);
    if (line !== undefined) {
      next.startLine = line;
      if (next.endLine === undefined) {
        next.endLine = line;
      }
    }
  }

  if (next.startLine === undefined && next.start_line !== undefined) {
    next.startLine = toPositiveInt(next.start_line) ?? next.start_line;
  }
  if (next.endLine === undefined && next.end_line !== undefined) {
    next.endLine = toPositiveInt(next.end_line) ?? next.end_line;
  }

  delete next.file;
  delete next.title;
  delete next.description;
  delete next.message;
  delete next.body;
  delete next.line;
  delete next.existing_code;
  delete next.anchor;
  delete next.code;
  delete next.start_line;
  delete next.end_line;

  return next;
}

function normalizeReadGitShowArguments(
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
  return next;
}

function toPositiveInt(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }
  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    const n = Number(value.trim());
    return n > 0 ? n : undefined;
  }
  return undefined;
}

function normalizeSearchFilesArguments(
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

function normalizeArgvCommandArguments(
  raw: Record<string, unknown>,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...raw };

  if (!hasNonEmptyArgv(next.argv)) {
    for (const alias of COMMAND_ALIASES) {
      const mapped = toArgv(next[alias]);
      if (mapped) {
        next.argv = mapped;
        break;
      }
    }
  }

  // Models sometimes send argv as a single shell string.
  if (typeof next.argv === "string") {
    const mapped = toArgv(next.argv);
    if (mapped) {
      next.argv = mapped;
    }
  }

  for (const alias of COMMAND_ALIASES) {
    delete next[alias];
  }
  delete next.cwd;
  delete next.shell;
  delete next.timeout;

  return next;
}

function normalizeGlobFilesArguments(
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

const EDGE_TYPE_ALIASES: Record<string, string> = {
  import: "imports",
  imported: "imports",
  call: "calls",
  called: "calls",
  reference: "references",
  refs: "references",
  extend: "extends",
  extended: "extends",
  implement: "implements",
  implemented: "implements",
  depends: "depends_on",
  depend: "depends_on",
  dependency: "depends_on",
  development_depends: "development_depends_on",
  dev_depends_on: "development_depends_on",
};

const VALID_EDGE_TYPES = new Set([
  "calls",
  "imports",
  "references",
  "extends",
  "implements",
  "depends_on",
  "development_depends_on",
]);

/**
 * Models often send singular edge type names (`import`) or empty arrays.
 * Map onto CHANGE_IMPACT_EDGE_TYPES before strict Zod validation.
 */
function normalizeAnalyzeChangeImpactArguments(
  raw: Record<string, unknown>,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...raw };
  if (Array.isArray(next.edgeTypes)) {
    const mapped = next.edgeTypes
      .map((entry) => {
        if (typeof entry !== "string") return undefined;
        const trimmed = entry.trim();
        if (!trimmed) return undefined;
        if (VALID_EDGE_TYPES.has(trimmed)) return trimmed;
        const alias = EDGE_TYPE_ALIASES[trimmed.toLowerCase()];
        return alias && VALID_EDGE_TYPES.has(alias) ? alias : undefined;
      })
      .filter((entry): entry is string => Boolean(entry));
    const deduped = [...new Set(mapped)];
    if (deduped.length > 0) {
      next.edgeTypes = deduped;
    } else {
      delete next.edgeTypes;
    }
  } else if (typeof next.edgeTypes === "string") {
    const trimmed = next.edgeTypes.trim();
    const alias =
      (VALID_EDGE_TYPES.has(trimmed) ? trimmed : undefined) ??
      EDGE_TYPE_ALIASES[trimmed.toLowerCase()];
    if (alias && VALID_EDGE_TYPES.has(alias)) {
      next.edgeTypes = [alias];
    } else {
      delete next.edgeTypes;
    }
  } else if (next.edgeTypes !== undefined) {
    delete next.edgeTypes;
  }
  return next;
}

function hasNonEmptyArgv(value: unknown): boolean {
  return Array.isArray(value) && value.length > 0;
}

/**
 * Best-effort split of a shell-ish command string into argv.
 * Does not implement a full shell parser — enough for `git status`, `cat file`.
 */
function toArgv(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    const parts = value.map(String).map((s) => s.trim()).filter(Boolean);
    return parts.length > 0 ? parts : undefined;
  }
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  // Prefer JSON array if the model stringified argv.
  if (trimmed.startsWith("[")) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        const parts = parsed.map(String).map((s) => s.trim()).filter(Boolean);
        return parts.length > 0 ? parts : undefined;
      }
    } catch {
      // fall through to whitespace split
    }
  }
  return splitShellish(trimmed);
}

function splitShellish(command: string): string[] {
  const parts: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  for (let i = 0; i < command.length; i += 1) {
    const ch = command[i]!;
    if (quote) {
      if (ch === quote) {
        quote = null;
      } else {
        current += ch;
      }
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (current.length > 0) {
        parts.push(current);
        current = "";
      }
      continue;
    }
    current += ch;
  }
  if (current.length > 0) {
    parts.push(current);
  }
  return parts;
}
