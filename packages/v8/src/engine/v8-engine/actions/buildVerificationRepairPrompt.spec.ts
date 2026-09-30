import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { VERIFICATION_SCHEMA_VERSION } from "../../../modules/verification";
import type { VerificationResult } from "../../../modules/verification";

import { buildVerificationRepairPrompt } from "./buildVerificationRepairPrompt";
import {
  diagnosticSourceLineKey,
  loadDiagnosticSourceLines,
} from "./loadDiagnosticSourceLines";

function verificationWithDiagnostic(
  path: string,
  startLine: number,
  message: string,
): VerificationResult {
  return {
    schemaVersion: VERIFICATION_SCHEMA_VERSION,
    status: "verification_failed",
    stateToken: "state-1",
    affectedProjectIds: [],
    checks: [],
    diagnostics: [
      {
        path,
        severity: "error",
        message,
        startLine,
        code: "TS2322",
      },
    ],
    diff: {
      reviewed: true,
      staleStateRisk: false,
      summary: "diff",
      changedPaths: [path],
    },
    warnings: [],
    reasonCodes: ["checks_failed"],
    durationMs: 1,
  };
}

describe("buildVerificationRepairPrompt", () => {
  it("appends a source line snippet when provided", () => {
    const path = "src/a.ts";
    const prompt = buildVerificationRepairPrompt({
      verification: verificationWithDiagnostic(
        path,
        3,
        "Type 'number' is not assignable to type 'string'.",
      ),
      changedFiles: [path],
      sourceLines: new Map([
        [diagnosticSourceLineKey(path, 3), "const name: string = 1;"],
      ]),
    });

    expect(prompt).toContain(`- ${path}:3 Type 'number' is not assignable`);
    expect(prompt).toContain("  | const name: string = 1;");
  });
});

describe("loadDiagnosticSourceLines", () => {
  it("reads the requested line from disk", async () => {
    const root = await mkdtemp(join(tmpdir(), "mitii-repair-src-"));
    try {
      await mkdir(join(root, "src"));
      await writeFile(
        join(root, "src", "a.ts"),
        "line1\nline2\nconst name: string = 1;\nline4\n",
        "utf8",
      );
      const lines = await loadDiagnosticSourceLines({
        workspaceRoot: root,
        diagnostics: [
          {
            path: "src/a.ts",
            severity: "error",
            message: "bad",
            startLine: 3,
          },
        ],
      });
      expect(lines.get(diagnosticSourceLineKey("src/a.ts", 3))).toBe(
        "const name: string = 1;",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
