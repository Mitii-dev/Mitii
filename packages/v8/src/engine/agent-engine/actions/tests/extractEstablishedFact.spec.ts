import { describe, expect, it } from "vitest";

import {
  dropEstablishedFactsForPaths,
  extractEstablishedFact,
  upsertEstablishedFact,
} from "../extractEstablishedFact";

describe("extractEstablishedFact", () => {
  it("pins a compact observation from a successful file read", () => {
    const fact = extractEstablishedFact({
      toolName: "read_file",
      argumentsValue: { path: "src/formik.ts" },
      output: "export function useFormik(): [Values, Helpers] {",
    });

    expect(fact).toMatchObject({
      id: "read_file:src/formik.ts",
    });
    expect(fact?.content).toContain("useFormik");
  });

  it("ignores mutation tools", () => {
    expect(
      extractEstablishedFact({
        toolName: "apply_patch",
        argumentsValue: { path: "src/a.ts" },
        output: "patched",
      }),
    ).toBeUndefined();
  });

  it("replaces the same locator and drops facts for mutated paths", () => {
    const facts = [];
    upsertEstablishedFact(
      facts,
      extractEstablishedFact({
        toolName: "read_file",
        argumentsValue: { path: "src/a.ts" },
        output: "const first = 1;",
      }),
    );
    upsertEstablishedFact(
      facts,
      extractEstablishedFact({
        toolName: "read_file",
        argumentsValue: { path: "src/a.ts" },
        output: "const first = 2;",
      }),
    );
    expect(facts).toHaveLength(1);
    expect(facts[0]?.content).toContain("first = 2");

    dropEstablishedFactsForPaths(facts, ["src/a.ts"]);
    expect(facts).toHaveLength(0);
  });
});
