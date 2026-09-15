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

  return value;
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
