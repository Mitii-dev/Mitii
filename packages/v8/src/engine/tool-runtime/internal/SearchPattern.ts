export type SearchPatternMode = "auto" | "literal" | "regex";
export type ResolvedSearchPatternMode = "literal" | "regex";

export interface ResolvedSearchPattern {
  mode: ResolvedSearchPatternMode;
  warning?: string;
  matches(line: string): boolean;
}

export function resolveSearchPattern(params: {
  query: string;
  mode?: SearchPatternMode;
  caseSensitive?: boolean;
}): ResolvedSearchPattern {
  const requestedMode = params.mode ?? "auto";

  if (requestedMode === "literal") {
    return buildLiteralPattern(params.query, params.caseSensitive);
  }

  if (requestedMode === "regex") {
    return buildRegexPattern(params.query, params.caseSensitive);
  }

  if (!looksLikeRegexQuery(params.query)) {
    return buildLiteralPattern(params.query, params.caseSensitive);
  }

  try {
    return buildRegexPattern(params.query, params.caseSensitive);
  } catch {
    return {
      ...buildLiteralPattern(params.query, params.caseSensitive),
      warning:
        "search_files auto mode treated a regex-like query as literal text because the pattern could not be compiled.",
    };
  }
}

function buildLiteralPattern(
  query: string,
  caseSensitive: boolean | undefined,
): ResolvedSearchPattern {
  const needle = caseSensitive ? query : query.toLowerCase();
  return {
    mode: "literal",
    matches(line: string): boolean {
      const haystack = caseSensitive ? line : line.toLowerCase();
      return haystack.includes(needle);
    },
  };
}

function buildRegexPattern(
  query: string,
  caseSensitive: boolean | undefined,
): ResolvedSearchPattern {
  let regex: RegExp;
  try {
    regex = new RegExp(query, caseSensitive ? "" : "i");
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Invalid regular expression.";
    throw new Error(message);
  }
  return {
    mode: "regex",
    matches(line: string): boolean {
      regex.lastIndex = 0;
      return regex.test(line);
    },
  };
}

function looksLikeRegexQuery(query: string): boolean {
  if (query.length === 0) {
    return false;
  }

  if (/\\[AbBdDsSwWZznrtfv0xu]/.test(query)) {
    return true;
  }
  if (/\(\?:|\(\?=|\(\?!|\(\?<=|\(\?<!/.test(query)) {
    return true;
  }
  const bracketMatches = query.match(/\[[^\]]*\]/g);
  if (
    bracketMatches?.some((value) => {
      const inner = value.slice(1, -1);
      return inner.startsWith("^") || inner.includes("-") || inner.length > 1;
    })
  ) {
    return true;
  }
  if (/(^|[^\\])(?:\.\*|\.\+|\.\?|\||\^|\$)/.test(query)) {
    return true;
  }
  if (/(^|[^\\])(?:\(|\)|\{[0-9,\s]*\}|\+|\*|\?)/.test(query)) {
    return true;
  }

  return false;
}
