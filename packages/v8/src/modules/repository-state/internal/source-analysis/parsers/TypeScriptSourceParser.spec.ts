import { describe, expect, it } from "vitest";

import { TypeScriptSourceParser } from "./TypeScriptSourceParser";

describe("TypeScriptSourceParser heritage", () => {
  it("classifies extends and implements identifiers as heritage references", async () => {
    const result = await new TypeScriptSourceParser().parse({
      sourceId: "src/child.ts",
      rootId: "root",
      relativePath: "src/child.ts",
      language: "typescript",
      content: [
        "class Child extends Base implements Port {",
        "  run(): void {}",
        "}",
      ].join("\n"),
      referenceCandidates: ["Base", "Port"],
    });

    const kinds = result.references
      .filter((reference) => reference.symbolName === "Base" || reference.symbolName === "Port")
      .map((reference) => [reference.symbolName, reference.kind]);

    expect(kinds).toEqual(
      expect.arrayContaining([
        ["Base", "extends"],
        ["Port", "implements"],
      ]),
    );
  });
});
