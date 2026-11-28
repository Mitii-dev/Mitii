import { describe, expect, it } from "vitest";

import {
  dropEstablishedFactsForPaths,
  extractEstablishedFact,
  upsertEstablishedFact,
  type EstablishedFact,
} from "../../../helpers/established-facts";

describe("extractEstablishedFact", () => {
  it("builds an observation fact from a successful read_file", () => {
    const fact = extractEstablishedFact({
      toolName: "read_file",
      argumentsValue: { path: "src/foo.ts" },
      output: { content: "export const foo = 1;" },
      outputPreview: "export const foo = 1;",
    });
    expect(fact?.kind).toBe("observation");
    expect(fact?.id).toContain("read_file");
    expect(fact?.content).toContain("src/foo.ts");
  });

  it("returns undefined for mutation tools", () => {
    expect(
      extractEstablishedFact({
        toolName: "apply_patch",
        argumentsValue: {},
        outputPreview: "ok",
      }),
    ).toBeUndefined();
  });

  it("upserts and drops facts by path", () => {
    const facts: EstablishedFact[] = [];
    upsertEstablishedFact(facts, {
      id: "read_file:src/a.ts",
      content: "a",
      kind: "observation",
      paths: ["src/a.ts"],
    });
    upsertEstablishedFact(facts, {
      id: "read_file:src/b.ts",
      content: "b",
      kind: "observation",
      paths: ["src/b.ts"],
    });
    expect(facts).toHaveLength(2);
    dropEstablishedFactsForPaths(facts, ["src/a.ts"]);
    expect(facts.map((f) => f.id)).toEqual(["read_file:src/b.ts"]);
  });
});
