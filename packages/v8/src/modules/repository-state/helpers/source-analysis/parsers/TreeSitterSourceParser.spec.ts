import { describe, expect, it } from "vitest";

import {
  TreeSitterSourceParser,
} from "./TreeSitterSourceParser";

import type {
  TreeSitterRuntimePort,
} from "../types";

describe("TreeSitterSourceParser", () => {
  it("injects catalog queries and prefers capture-derived symbol kinds", async () => {
    let seenSymbolQuery = "";
    let seenReferenceQuery = "";

    const runtime: TreeSitterRuntimePort = {
      id: "fake-tree-sitter",
      supports: (language) =>
        language === "python",
      parse: async (input) => {
        seenSymbolQuery =
          input.symbolQuery ?? "";
        seenReferenceQuery =
          input.referenceQuery ?? "";

        return {
          symbols: [
            {
              name: "process",
              nodeType:
                "function_definition",
              kind: "function",
              startLine: 2,
              endLine: 3,
            },
          ],
          imports: [],
          references: [
            {
              symbolName: "process",
              kind: "call",
              line: 6,
            },
          ],
          warnings: [],
        };
      },
    };

    const parser =
      new TreeSitterSourceParser(
        runtime,
      );

    expect(
      parser.supports(
        "python",
        "src/charge.py",
      ),
    ).toBe(true);

    const result = await parser.parse({
      sourceId: "source:python",
      rootId: "root",
      relativePath: "src/charge.py",
      language: "python",
      content:
        "class ChargeService:\n    def process(self):\n        return 1\n\ndef handle_checkout():\n    charge_service.process()\n",
    });

    expect(seenSymbolQuery).toMatch(
      /function_definition/,
    );
    expect(seenReferenceQuery).toMatch(
      /attribute/,
    );
    expect(result.parserId).toBe(
      "tree-sitter",
    );
    expect(result.quality).toBe(
      "structural",
    );
    expect(result.symbols[0]).toMatchObject({
      name: "process",
      kind: "function",
    });
    expect(result.references[0]).toMatchObject({
      symbolName: "process",
      kind: "call",
    });
  });

  it("supports dialect languages when the runtime has a grammar", () => {
    const runtime: TreeSitterRuntimePort = {
      id: "fake-tree-sitter",
      supports: (language) =>
        language === "lua",
      parse: async () => ({
        symbols: [],
        imports: [],
        references: [],
      }),
    };

    const parser =
      new TreeSitterSourceParser(
        runtime,
      );

    expect(
      parser.supports(
        "lua",
        "nginx/charge_dedupe.lua",
      ),
    ).toBe(true);
    expect(
      parser.supports(
        "python",
        "src/app.py",
      ),
    ).toBe(false);
  });
});
