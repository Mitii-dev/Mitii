import { describe, expect, it } from "vitest";

import { buildPreflightDiagnosticRepairInstruction } from "../buildPreflightDiagnosticRepairInstruction";
import type { VerificationDiagnostic } from "../../../../modules/verification";

describe("buildPreflightDiagnosticRepairInstruction", () => {
  const diagnostics: VerificationDiagnostic[] = [
    {
      path: "packages/mui-builder/src/Button.tsx",
      severity: "error",
      message: "Type 'string' is not assignable to type 'number'.",
      startLine: 12,
      source: "tsc",
      code: "TS2322",
    },
    {
      path: "packages/mui-builder/src/Text.tsx",
      severity: "error",
      message: "Property 'field' does not exist on type FieldTextProps.",
      startLine: 30,
      source: "tsc",
      code: "TS2339",
    },
    {
      path: "packages/other/src/Other.ts",
      severity: "error",
      message: "Out of scope.",
      startLine: 1,
      source: "tsc",
      code: "TS1000",
    },
  ];

  it("summarizes scoped preflight diagnostics as repair instructions", () => {
    const instruction = buildPreflightDiagnosticRepairInstruction({
      diagnostics,
      totalErrorCount: 126,
      pathScopes: ["packages/mui-builder"],
      maxDiagnostics: 2,
      maxChars: 2_000,
    });

    expect(instruction).toContain("Preflight verification already captured 126");
    expect(instruction).toContain("packages/mui-builder/src/Button.tsx:12 TS2322");
    expect(instruction).toContain("packages/mui-builder/src/Text.tsx:30 TS2339");
    expect(instruction).toContain("There are 124 additional error(s)");
    expect(instruction).not.toContain("packages/other");
  });

  it("returns undefined when no diagnostic fits the current scope", () => {
    expect(
      buildPreflightDiagnosticRepairInstruction({
        diagnostics,
        totalErrorCount: 126,
        pathScopes: ["packages/not-mui"],
        maxDiagnostics: 2,
        maxChars: 2_000,
      }),
    ).toBeUndefined();
  });
});
