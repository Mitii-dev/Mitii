import {
  TEXT_INDEX_DEFAULTS,
  TEXT_INDEX_ERRORS,
  TEXT_INDEX_MESSAGES,
  TEXT_INDEX_PATTERNS,
} from "./constants";

import type {
  NormalizedTextSearchRequest,
  TextSearchInput,
  TextSearchNormalization,
  TextSearchWarning,
} from "./types";

export function splitCodeIdentifier(
  term: string,
): string[] {
  return term
    .replace(
      /([a-z0-9])([A-Z])/g,
      "$1 $2",
    )
    .replace(
      /([A-Z]+)([A-Z][a-z])/g,
      "$1 $2",
    )
    .split(
      /[^a-zA-Z0-9]+/,
    )
    .map((value) =>
      value.toLowerCase(),
    )
    .filter(
      (value) =>
        value.length >=
        TEXT_INDEX_DEFAULTS
          .MINIMUM_TERM_CHARACTERS,
    );
}

export class TextQueryNormalizer {
  public normalize(
    input: TextSearchInput,
  ): TextSearchNormalization {
    if (!input.workspace.trim()) {
      throw new TypeError(
        TEXT_INDEX_ERRORS
          .WORKSPACE_REQUIRED,
      );
    }

    const warnings:
      TextSearchWarning[] = [];

    const originalQuery =
      input.query;

    const boundedQuery =
      originalQuery.length >
      TEXT_INDEX_DEFAULTS
        .MAXIMUM_QUERY_CHARACTERS
        ? originalQuery.slice(
            0,
            TEXT_INDEX_DEFAULTS
              .MAXIMUM_QUERY_CHARACTERS,
          )
        : originalQuery;

    if (
      boundedQuery.length !==
      originalQuery.length
    ) {
      warnings.push({
        code: "query_truncated",
        message:
          TEXT_INDEX_MESSAGES
            .QUERY_TRUNCATED,
      });
    }

    const rawTerms =
      boundedQuery.match(
        TEXT_INDEX_PATTERNS
          .QUERY_TERM,
      ) ?? [];

    const expandedTerms =
      rawTerms.map(
        (term) =>
          this.expandTerm(term),
      );

    const eligibleTerms =
      expandedTerms.flat();

    if (
      expandedTerms.some(
        (terms) =>
          terms.length === 0,
      )
    ) {
      warnings.push({
        code: "terms_removed",
        message:
          TEXT_INDEX_MESSAGES
            .TERMS_REMOVED,
      });
    }

    const uniqueTerms = [
      ...new Set(
        eligibleTerms,
      ),
    ];

    const terms =
      uniqueTerms.slice(
        0,
        TEXT_INDEX_DEFAULTS
          .MAXIMUM_QUERY_TERMS,
      );

    if (
      terms.length !==
      uniqueTerms.length
    ) {
      warnings.push({
        code: "terms_truncated",
        message:
          TEXT_INDEX_MESSAGES
            .TERMS_TRUNCATED,
      });
    }

    if (terms.length === 0) {
      return {
        warnings,
      };
    }

    const rootIds =
      this.normalizeFilters(
        input.rootIds,
        warnings,
      );

    const filePaths =
      this.normalizeFilters(
        input.filePaths,
        warnings,
      );

    const kinds =
      this.normalizeFilters(
        input.kinds,
        warnings,
      );

    const request:
      NormalizedTextSearchRequest = {
      workspace:
        input.workspace.trim(),
      originalQuery,
      terms,
      mode:
        input.mode ??
        TEXT_INDEX_DEFAULTS
          .SEARCH_MODE,
      prefixMatching:
        input.prefixMatching ??
        TEXT_INDEX_DEFAULTS
          .PREFIX_MATCHING,
      maximumResults:
        this.resolveBoundedPositive(
          input.maximumResults,
          TEXT_INDEX_DEFAULTS
            .MAXIMUM_RESULTS,
          TEXT_INDEX_DEFAULTS
            .MAXIMUM_ALLOWED_RESULTS,
          "maximumResults",
        ),
      snippetTokenCount:
        this.resolveBoundedPositive(
          input
            .snippetTokenCount,
          TEXT_INDEX_DEFAULTS
            .SNIPPET_TOKEN_COUNT,
          TEXT_INDEX_DEFAULTS
            .MAXIMUM_SNIPPET_TOKEN_COUNT,
          "snippetTokenCount",
        ),
      rootIds,
      filePaths,
      kinds,
      ...(input.folderPrefix
        ?.trim()
        ? {
            folderPrefix:
              this.normalizePath(
                input
                  .folderPrefix,
              ),
          }
        : {}),
    };

    return {
      request,
      warnings,
    };
  }

  private normalizeFilters<T extends string>(
    values:
      readonly T[] | undefined,
    warnings:
      TextSearchWarning[],
  ): T[] {
    const normalized =
      (values ?? [])
        .map((value) =>
          value.trim(),
        )
        .filter(Boolean) as T[];

    const unique = [
      ...new Set(normalized),
    ];

    if (
      unique.length !==
      normalized.length
    ) {
      warnings.push({
        code:
          "duplicate_filter_removed",
        message:
          TEXT_INDEX_MESSAGES
            .DUPLICATE_FILTER_REMOVED,
      });
    }

    return unique.slice(
      0,
      TEXT_INDEX_DEFAULTS
        .MAXIMUM_FILTER_VALUES,
    );
  }

  private expandTerm(
    term: string,
  ): string[] {
    const lower =
      term.toLowerCase();
    const parts =
      splitCodeIdentifier(
        term,
      );

    const expanded =
      [
        lower,
        ...parts,
      ];

    const compact =
      parts.join("");

    if (
      compact.length >=
        TEXT_INDEX_DEFAULTS
          .MINIMUM_TERM_CHARACTERS &&
      compact !== lower
    ) {
      expanded.push(
        compact,
      );
    }

    return expanded.filter(
      (value) =>
        value.length >=
        TEXT_INDEX_DEFAULTS
          .MINIMUM_TERM_CHARACTERS,
    );
  }

  private resolveBoundedPositive(
    value:
      number | undefined,
    fallback: number,
    maximum: number,
    name: string,
  ): number {
    const resolved =
      value ?? fallback;

    if (
      !Number.isSafeInteger(
        resolved,
      ) ||
      resolved <= 0
    ) {
      throw new RangeError(
        `${name}: ${TEXT_INDEX_ERRORS.POSITIVE_INTEGER_REQUIRED}`,
      );
    }

    return Math.min(
      resolved,
      maximum,
    );
  }

  private normalizePath(
    value: string,
  ): string {
    return value
      .trim()
      .replace(/\\/g, "/")
      .replace(/^\.\/+/, "")
      .replace(/^\/+|\/+$/g, "");
  }
}
