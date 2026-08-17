import { describe, expect, it } from "vitest";

import {
  dropEstablishedFactsForPaths,
  extractCompilerErrorQueue,
  extractEstablishedFact,
  upsertEstablishedFact,
} from "../extractEstablishedFact";

describe("extractEstablishedFact", () => {
  it("pins a compact observation from a successful file read", () => {
    const fact = extractEstablishedFact({
      toolName: "read_file",
      argumentsValue: { path: "src/formik.ts", startLine: 12, endLine: 18 },
      output: "export function useFormik(): [Values, Helpers] {",
    });

    expect(fact).toMatchObject({
      id: "read_file:src/formik.ts:12-18",
    });
    expect(fact?.content).toContain("src/formik.ts:12-18 =>");
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

  it("summarizes search matches and respects the caller budget", () => {
    const fact = extractEstablishedFact({
      toolName: "search_files",
      argumentsValue: { query: "FieldType" },
      maxChars: 80,
      output: {
        matches: [
          {
            path: "src/types/common-types.ts",
            line: 12,
            text: "export interface FieldType { field: string; type?: string }",
          },
        ],
      },
    });

    expect(fact?.id).toBe("search_files:FieldType");
    expect(fact?.content).toContain("src/types/common-types.ts:12");
    expect((fact?.content.length ?? 0)).toBeLessThan(120);
  });

  it("pins a compact compiler error queue from tsc stdout", () => {
    const stdout = [
      "packages/mui-builder/src/fields/field-autocomplete/field-autocomplete.tsx(8,53): error TS2345: Argument of type 'CommonFieldProps' is not assignable to parameter of type 'string | FieldHookConfig<any>'.",
      "packages/mui-builder/src/fields/field-checkbox/field-checkbox.tsx(8,53): error TS2345: Argument of type 'CommonFieldProps' is not assignable to parameter of type 'string | FieldHookConfig<any>'.",
    ].join("\n");

    expect(extractCompilerErrorQueue({ stdout })).toContain("TS2345");

    const fact = extractEstablishedFact({
      toolName: "run_readonly_command",
      argumentsValue: { argv: ["npx", "tsc", "--noEmit"] },
      output: { argv: ["npx", "tsc", "--noEmit"], exitCode: 2, stdout },
    });

    expect(fact?.id).toBe("error-queue:compiler");
    expect(fact?.content).toContain("field-autocomplete.tsx:8 TS2345");
    expect(fact?.content).toContain("field-checkbox.tsx:8 TS2345");
  });

  it("uses the caller max fact count when upserting", () => {
    const facts = [];
    for (let index = 0; index < 5; index += 1) {
      upsertEstablishedFact(
        facts,
        {
          id: `read_file:src/${index}.ts`,
          content: `src/${index}.ts => finding`,
        },
        { maxFacts: 3 },
      );
    }

    expect(facts).toHaveLength(3);
    expect(facts[0]?.id).toBe("read_file:src/2.ts");
  });
});
