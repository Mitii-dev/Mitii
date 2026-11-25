import { describe, expect, it } from "vitest";

import {
  adaptTreeSitterTagsQuery,
  splitTreeSitterTagsQuery,
  stripUnsupportedTreeSitterPredicates,
} from "./adaptTreeSitterTagsQuery";

describe("adaptTreeSitterTagsQuery", () => {
  it("strips tags-only predicates that web-tree-sitter cannot compile", () => {
    const source = `
(
  (comment)* @doc
  .
  (function_declaration
    name: (identifier) @name.definition.function) @definition.function
  (#strip! @doc "^//\\\\s*")
  (#select-adjacent! @doc @definition.function)
  (#not-match? @name.definition.function "^(require)$")
)
`;

    const stripped =
      stripUnsupportedTreeSitterPredicates(
        source,
      );

    expect(stripped).not.toMatch(
      /#strip!/,
    );
    expect(stripped).not.toMatch(
      /#select-adjacent!/,
    );
    expect(stripped).toMatch(
      /#not-match\?/,
    );
    expect(stripped).toMatch(
      /@name\.definition\.function/,
    );
  });

  it("splits mixed tags into symbol and reference queries", () => {
    const split = splitTreeSitterTagsQuery(`
(function_definition
  name: (identifier) @name.definition.function) @definition.function

(call
  function: (identifier) @name.reference.call) @reference.call

(lexical_declaration
  (variable_declarator name: (identifier) @name) @definition)
`);

    expect(split.symbolQuery).toMatch(
      /function_definition/,
    );
    expect(split.symbolQuery).toMatch(
      /lexical_declaration/,
    );
    expect(split.symbolQuery).not.toMatch(
      /@reference\.call/,
    );
    expect(split.referenceQuery).toMatch(
      /@name\.reference\.call/,
    );
    expect(split.referenceQuery).not.toMatch(
      /function_definition/,
    );
    expect(split.symbolQuery).toMatch(
      /@definition\.function/,
    );
  });

  it("keeps captures that follow a closed node like (FnProto) @name", () => {
    const split = splitTreeSitterTagsQuery(
      "(FnProto) @name.definition.function @definition.function\n",
    );

    expect(split.symbolQuery).toMatch(
      /@name\.definition\.function/,
    );
    expect(split.symbolQuery).toMatch(
      /@definition\.function/,
    );
  });

  it("keeps definition-only haskell captures in the symbol query", () => {
    const adapted = adaptTreeSitterTagsQuery(`
(function (variable) @name.definition.function)
; ignore this comment
(call (identifier) @name.reference.call) @reference.call
`);

    expect(adapted.symbolQuery).toMatch(
      /@name\.definition\.function/,
    );
    expect(adapted.referenceQuery).toMatch(
      /@name\.reference\.call/,
    );
  });
});
