import { describe, expect, it } from "vitest";

import type { ProjectDescriptor } from "../../repository-state";
import { normalizeDiagnostics } from "../actions/NormalizeDiagnostics";
import type { VerificationCheckResult } from "../contracts";

const PROJECT: ProjectDescriptor = {
  projectId: "packages/mui-builder",
  rootPath: "packages/mui-builder",
  primaryLanguageId: "typescript",
  manifestPaths: ["packages/mui-builder/package.json"],
};

function check(overrides: Partial<VerificationCheckResult>): VerificationCheckResult {
  return {
    checkId: "inferred:packages/mui-builder:typecheck:build",
    kind: "diagnostics",
    projectId: "packages/mui-builder",
    label: "pnpm build (inferred:packages/mui-builder)",
    evidenceSource: "pnpm build",
    outcome: "failed",
    summary: "pnpm build failed (exit 1)",
    toolCallId: "call-1",
    ...overrides,
  };
}

describe("normalizeDiagnostics", () => {
  it("joins a diagnostics-tool path to its check's project root", () => {
    const diagnostics = normalizeDiagnostics({
      checks: [check({})],
      toolOutputs: new Map([
        [
          "call-1",
          {
            diagnostics: [
              {
                path: "src/fields/field-radio/field-radio.tsx",
                severity: "error",
                message: "Type 'number' is not assignable to type 'string'.",
                startLine: 24,
                code: "TS2322",
              },
            ],
          },
        ],
      ]),
      projects: [PROJECT],
    });

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.path).toBe(
      "packages/mui-builder/src/fields/field-radio/field-radio.tsx",
    );
  });

  it("joins a compiler-text path to its check's project root", () => {
    const diagnostics = normalizeDiagnostics({
      checks: [
        check({
          checkId: "inferred:packages/mui-builder:lint:lint",
          kind: "lint",
        }),
      ],
      toolOutputs: new Map([
        [
          "call-1",
          {
            stdout:
              "src/FormBuilder.tsx(7,1): error TS2305: Module '\"./types\"' has no exported member 'FormBuilderProps'.",
          },
        ],
      ]),
      projects: [PROJECT],
    });

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.path).toBe(
      "packages/mui-builder/src/FormBuilder.tsx",
    );
  });

  it("leaves an already workspace-relative path untouched", () => {
    const diagnostics = normalizeDiagnostics({
      checks: [check({})],
      toolOutputs: new Map([
        [
          "call-1",
          {
            diagnostics: [
              {
                path: "packages/mui-builder/src/FormBuilder.tsx",
                severity: "error",
                message: "already scoped",
              },
            ],
          },
        ],
      ]),
      projects: [PROJECT],
    });

    expect(diagnostics[0]?.path).toBe(
      "packages/mui-builder/src/FormBuilder.tsx",
    );
  });

  it("leaves the path unchanged when no project match exists", () => {
    const diagnostics = normalizeDiagnostics({
      checks: [check({ projectId: "packages/unmapped" })],
      toolOutputs: new Map([
        [
          "call-1",
          {
            diagnostics: [
              {
                path: "src/x.ts",
                severity: "error",
                message: "no project root to resolve against",
              },
            ],
          },
        ],
      ]),
      projects: [PROJECT],
    });

    expect(diagnostics[0]?.path).toBe("src/x.ts");
  });
});
