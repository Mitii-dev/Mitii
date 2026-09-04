import { expandCodeIdentifierTerms } from "../../../modules/repository-state";

/** Minimum identifier-term length for star-term discovery globs. */
const GLOB_HINT_MINIMUM_TERM_CHARACTERS = 4;

const COMMON_SOURCE_EXTENSION_GLOBS = [
  "ts",
  "tsx",
  "js",
  "jsx",
] as const;

/**
 * Build discovery glob patterns for a missing workspace-relative path.
 * Ports the useful parts of legacy `globPatternsForMention`, using shared
 * {@link expandCodeIdentifierTerms} instead of a parallel CamelCase splitter.
 */
export function buildMissingPathGlobHints(relativePath: string): string[] {
  const normalized = relativePath
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\.\//, "");
  if (!normalized || normalized === ".") {
    return [];
  }

  const base = basename(normalized);
  const patterns: string[] = [];

  if (normalized.includes("/")) {
    patterns.push(normalized, `**/${normalized}`);
  } else {
    patterns.push(`**/${normalized}`, `**/*/${normalized}`);
  }

  if (base.includes(".")) {
    patterns.push(`**/${base}`);
  } else if (base.length > 0) {
    patterns.push(`**/*${base}*`);
  }

  const stem = stripExtension(base);
  for (const term of expandCodeIdentifierTerms(stem)) {
    if (term.length < GLOB_HINT_MINIMUM_TERM_CHARACTERS) {
      continue;
    }
    for (const ext of COMMON_SOURCE_EXTENSION_GLOBS) {
      patterns.push(`**/*${term}*.${ext}`);
    }
  }

  return uniquePreserveOrder(patterns);
}

/**
 * Compact hint list for tool error messages (primary + optional CamelCase).
 */
export function selectMissingPathGlobHintsForMessage(
  relativePath: string,
  maximum = 2,
): string[] {
  const all = buildMissingPathGlobHints(relativePath);
  if (all.length === 0) {
    return [];
  }

  const base = basename(relativePath.replace(/\\/g, "/"));
  const primary =
    all.find((pattern) =>
      base.includes(".")
        ? pattern === `**/${base}`
        : pattern === `**/*${base}*` || pattern === `**/${base}`,
    ) ?? all[0]!;

  const selected = [primary];
  for (const pattern of all) {
    if (selected.length >= maximum) {
      break;
    }
    if (pattern === primary) {
      continue;
    }
    // Prefer CamelCase stem globs over redundant full-path duplicates.
    if (/\*\*\/\*[^*]+\*\.(?:tsx?|jsx?)$/i.test(pattern)) {
      selected.push(pattern);
    }
  }

  if (selected.length < maximum) {
    for (const pattern of all) {
      if (selected.length >= maximum) {
        break;
      }
      if (!selected.includes(pattern)) {
        selected.push(pattern);
      }
    }
  }

  return selected;
}

function basename(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx >= 0 ? path.slice(idx + 1) : path;
}

function stripExtension(filename: string): string {
  const idx = filename.lastIndexOf(".");
  if (idx <= 0) {
    return filename;
  }
  return filename.slice(0, idx);
}

function uniquePreserveOrder(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    if (seen.has(value)) {
      continue;
    }
    seen.add(value);
    out.push(value);
  }
  return out;
}
