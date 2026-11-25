import { describe, expect, it } from "vitest";

import {
  listTreeSitterQueryLanguages,
  resolveTreeSitterQueries,
  SOURCE_TREE_SITTER_REFERENCE_QUERIES,
  SOURCE_TREE_SITTER_SYMBOL_QUERIES,
} from "./TreeSitterQueryCatalog";

describe("TreeSitterQueryCatalog", () => {
  it("covers first-class tree-sitter languages plus high-value dialects", () => {
    const languages =
      listTreeSitterQueryLanguages();

    for (const language of [
      "python",
      "javascript",
      "typescript",
      "tsx",
      "go",
      "java",
      "rust",
      "c",
      "cpp",
      "csharp",
      "kotlin",
      "swift",
      "ruby",
      "php",
      "shell",
      "sql",
      "lua",
      "elixir",
      "dart",
      "zig",
      "scala",
      "haskell",
      "solidity",
    ]) {
      expect(languages).toContain(
        language,
      );
    }
  });

  it("resolves bash and c_sharp aliases onto host language ids", () => {
    expect(
      resolveTreeSitterQueries("bash")
        ?.symbolQuery,
    ).toBe(
      SOURCE_TREE_SITTER_SYMBOL_QUERIES
        .shell,
    );
    expect(
      resolveTreeSitterQueries("c_sharp")
        ?.symbolQuery,
    ).toBe(
      SOURCE_TREE_SITTER_SYMBOL_QUERIES
        .csharp,
    );
  });

  it("injects python attribute-call refs and keeps function_definition for baseline tests", () => {
    const queries =
      resolveTreeSitterQueries(
        "python",
      );

    expect(queries?.symbolQuery).toMatch(
      /function_definition/,
    );
    expect(
      queries?.referenceQuery,
    ).toMatch(
      /attribute/,
    );
    expect(
      queries?.referenceQuery,
    ).not.toMatch(
      /@reference\.read/,
    );
  });

  it("does not tag every javascript lexical declaration", () => {
    const queries =
      resolveTreeSitterQueries(
        "javascript",
      );

    expect(queries?.symbolQuery).toMatch(
      /arrow_function/,
    );
    expect(queries?.symbolQuery).toMatch(
      /variable_declarator[\s\S]*value:/,
    );
    expect(
      queries?.referenceQuery,
    ).toMatch(
      /member_expression/,
    );
  });

  it("returns undefined for languages without a catalog entry", () => {
    expect(
      resolveTreeSitterQueries("unknown"),
    ).toBeUndefined();
    expect(
      Object.hasOwn(
        SOURCE_TREE_SITTER_REFERENCE_QUERIES,
        "sql",
      ),
    ).toBe(false);
  });
});
