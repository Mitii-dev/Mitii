import { COMMAND_ALIASES, hasNonEmptyArgv, toArgv, toPositiveInt } from "./helpers";

export function normalizeEmitReviewFindingArguments(
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
export function normalizeArgvCommandArguments(
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
export function normalizeAnalyzeChangeImpactArguments(
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
