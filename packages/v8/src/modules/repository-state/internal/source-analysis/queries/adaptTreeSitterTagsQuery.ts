/**
 * Adapts aider-style tags.scm queries for Mitii injection.
 *
 * V8 owns query text. The host WASM runtime compiles whatever string
 * TreeSitterSourceParser injects. This adapter:
 * 1. Strips tags-only predicates web-tree-sitter cannot compile.
 * 2. Splits mixed def/ref files into the two query strings the port expects.
 */

export interface SplitTreeSitterTagsQuery {
  symbolQuery: string;
  referenceQuery: string;
}

const UNSUPPORTED_PREDICATE_NAMES =
  new Set([
    "strip",
    "select-adjacent",
    "set-adjacent",
    "is",
    "is-not",
  ]);

export const stripUnsupportedTreeSitterPredicates = (
  source: string,
): string => {
  let result = "";
  let index = 0;

  while (index < source.length) {
    const start =
      source.indexOf("(#", index);

    if (start === -1) {
      result += source.slice(index);
      break;
    }

    result += source.slice(index, start);

    const end =
      findMatchingParen(source, start);

    if (end === -1) {
      result += source.slice(start);
      break;
    }

    const inner =
      source
        .slice(start + 2, end)
        .trim();

    const name =
      predicateName(inner);

    if (
      UNSUPPORTED_PREDICATE_NAMES.has(
        name,
      )
    ) {
      result = result.replace(
        /[ \t]+$/u,
        "",
      );
      index = end + 1;
      continue;
    }

    result += source.slice(
      start,
      end + 1,
    );
    index = end + 1;
  }

  return collapseBlankLines(result);
};

export const splitTreeSitterTagsQuery = (
  source: string,
): SplitTreeSitterTagsQuery => {
  const expressions =
    splitTopLevelSExpressions(
      source,
    );

  const symbols: string[] = [];
  const references: string[] = [];

  for (const expression of expressions) {
    const isReference =
      /@name\.reference\.|@reference\./u.test(
        expression,
      );

    const isDefinition =
      /@name\.definition\.|@definition\./u.test(
        expression,
      ) ||
      (
        /@name\b/u.test(expression) &&
        /@definition\b/u.test(expression)
      );

    if (isDefinition) {
      symbols.push(expression);
    }

    if (isReference) {
      references.push(expression);
    }
  }

  return {
    symbolQuery:
      symbols.join("\n\n"),
    referenceQuery:
      references.join("\n\n"),
  };
};

export const adaptTreeSitterTagsQuery = (
  source: string,
): SplitTreeSitterTagsQuery =>
  splitTreeSitterTagsQuery(
    stripUnsupportedTreeSitterPredicates(
      source,
    ),
  );

const predicateName = (
  inner: string,
): string => {
  const raw =
    inner.split(/\s/u, 1)[0] ?? "";

  return raw.replace(/[?!]+$/u, "");
};

const findMatchingParen = (
  source: string,
  openIndex: number,
): number => {
  let depth = 0;

  for (
    let index = openIndex;
    index < source.length;
    index += 1
  ) {
    const character =
      source[index];

    if (character === "(") {
      depth += 1;
      continue;
    }

    if (character === ")") {
      depth -= 1;

      if (depth === 0) {
        return index;
      }
    }
  }

  return -1;
};

const splitTopLevelSExpressions = (
  source: string,
): string[] => {
  const expressions: string[] = [];
  let depth = 0;
  let start = -1;

  for (
    let index = 0;
    index < source.length;
    index += 1
  ) {
    const character =
      source[index];

    if (
      character === ";" &&
      depth === 0
    ) {
      const newline =
        source.indexOf("\n", index);

      index =
        newline === -1
          ? source.length
          : newline;
      continue;
    }

    if (character === "(") {
      if (depth === 0) {
        start = index;
      }

      depth += 1;
      continue;
    }

    if (character === ")") {
      depth -= 1;

        if (
          depth === 0 &&
          start >= 0
        ) {
          let end = index + 1;

          while (end < source.length) {
            const trailing =
              source
                .slice(end)
                .match(
                  /^[ \t]*@[A-Za-z0-9_.]+/u,
                );

            if (!trailing) {
              break;
            }

            end += trailing[0].length;
          }

          const expression =
            source
              .slice(start, end)
              .trim();

          if (expression.length > 0) {
            expressions.push(
              expression,
            );
          }

          start = -1;
          index = end - 1;
        }
    }
  }

  return expressions;
};

const collapseBlankLines = (
  source: string,
): string =>
  source
    .replace(/[ \t]+$/gmu, "")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
