import {
  adaptTreeSitterTagsQuery,
} from "./adaptTreeSitterTagsQuery";

import {
  BUNDLED_TREE_SITTER_TAGS_QUERIES,
} from "./bundledTreeSitterQueries";

export interface TreeSitterLanguageQueries {
  symbolQuery: string;
  referenceQuery?: string;
}

/**
 * Dialects and grammar pack aliases collapse onto the language id
 * LanguageDetector / WASM runtime already use.
 */
export const TREE_SITTER_QUERY_LANGUAGE_ALIASES: Readonly<
  Record<string, string>
> = {
  bash: "shell",
  sh: "shell",
  zsh: "shell",
  c_sharp: "csharp",
  cs: "csharp",
  ts: "typescript",
  js: "javascript",
  py: "python",
};

const compiled =
  compileBundledQueries();

export const SOURCE_TREE_SITTER_SYMBOL_QUERIES: Readonly<
  Record<string, string>
> = compiled.symbolQueries;

export const SOURCE_TREE_SITTER_REFERENCE_QUERIES: Readonly<
  Record<string, string>
> = compiled.referenceQueries;

export const resolveTreeSitterQueries = (
  language: string,
): TreeSitterLanguageQueries | undefined => {
  const normalized =
    normalizeTreeSitterQueryLanguage(
      language,
    );

  const symbolQuery =
    SOURCE_TREE_SITTER_SYMBOL_QUERIES[
      normalized
    ];

  if (!symbolQuery) {
    return undefined;
  }

  const referenceQuery =
    SOURCE_TREE_SITTER_REFERENCE_QUERIES[
      normalized
    ];

  return {
    symbolQuery,
    ...(referenceQuery
      ? { referenceQuery }
      : {}),
  };
};

export const listTreeSitterQueryLanguages =
  (): readonly string[] =>
    Object.keys(
      SOURCE_TREE_SITTER_SYMBOL_QUERIES,
    ).sort(
      (left, right) =>
        left.localeCompare(right),
    );

export const normalizeTreeSitterQueryLanguage = (
  language: string,
): string => {
  const trimmed =
    language.trim().toLowerCase();

  return TREE_SITTER_QUERY_LANGUAGE_ALIASES[
    trimmed
  ] ?? trimmed;
};

function compileBundledQueries(): {
  symbolQueries: Record<string, string>;
  referenceQueries: Record<string, string>;
} {
  const symbolQueries: Record<string, string> = {};
  const referenceQueries: Record<string, string> = {};

  for (
    const [
      language,
      source,
    ] of Object.entries(
      BUNDLED_TREE_SITTER_TAGS_QUERIES,
    )
  ) {
    const adapted =
      adaptTreeSitterTagsQuery(
        source,
      );

    if (
      adapted.symbolQuery.trim()
        .length > 0
    ) {
      symbolQueries[language] =
        adapted.symbolQuery;
    }

    if (
      adapted.referenceQuery.trim()
        .length > 0
    ) {
      referenceQueries[language] =
        adapted.referenceQuery;
    }
  }

  return {
    symbolQueries,
    referenceQueries,
  };
}
