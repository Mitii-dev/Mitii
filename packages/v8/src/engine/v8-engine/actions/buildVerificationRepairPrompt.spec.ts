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

  it("keeps ask-scoped diagnostics and drops node_modules residuals", () => {
    const prompt = buildVerificationRepairPrompt({
      verification: {
        schemaVersion: VERIFICATION_SCHEMA_VERSION,
        status: "verification_failed",
        stateToken: "state-1",
        affectedProjectIds: [],
        checks: [],
        diagnostics: [
          {
            path: "apps/desktop/src/renderer/SettingsPanel.tsx",
            severity: "error",
            message: "tab redirect broken",
            startLine: 10,
          },
          {
            path: "node_modules/vitest/dist/chunks/index.js",
            severity: "error",
            message: "EventEmitter",
            startLine: 1,
          },
          {
            path: "❯ EventEmitter.onMessage ../../node_modules/vitest/dist/chunks/index.B521nVV-.js",
            severity: "error",
            message: "20",
            startLine: 103,
          },
          {
            path: "packages/other/src/unrelated.ts",
            severity: "error",
            message: "unrelated",
            startLine: 1,
          },
        ],
        diff: {
          reviewed: true,
          staleStateRisk: false,
          summary: "diff",
          changedPaths: ["apps/desktop/src/renderer/styles.css"],
        },
        warnings: [],
        reasonCodes: ["checks_failed"],
        durationMs: 1,
      },
      changedFiles: ["apps/desktop/src/renderer/styles.css"],
      askScopePaths: ["apps/desktop"],
    });

    expect(prompt).toContain("SettingsPanel.tsx");
    expect(prompt).not.toContain("node_modules/vitest");
    expect(prompt).not.toContain("packages/other");
    expect(prompt).toContain("Never edit node_modules");
  });

  it("does not fall back to out-of-scope diagnostics when ask scope is known", () => {
    const prompt = buildVerificationRepairPrompt({
      verification: {
        schemaVersion: VERIFICATION_SCHEMA_VERSION,
        status: "verification_failed",
        stateToken: "state-1",
        affectedProjectIds: [],
        checks: [
          {
            checkId: "inferred:apps/desktop:typecheck:typecheck",
            kind: "typecheck",
            label: "typecheck",
            evidenceSource: "manifest",
            outcome: "failed",
            summary: "failed",
          },
        ],
        diagnostics: [
          {
            path: "node_modules/vitest/dist/chunks/index.js",
            severity: "error",
            message: "EventEmitter.onMessage",
            startLine: 103,
          },
          {
            path: "packages/other/src/unrelated.ts",
            severity: "error",
            message: "unrelated",
            startLine: 1,
          },
        ],
        diff: {
          reviewed: true,
          staleStateRisk: false,
          summary: "diff",
          changedPaths: ["apps/desktop/src/renderer/App.tsx"],
        },
        warnings: [],
        reasonCodes: ["checks_failed"],
        durationMs: 1,
      },
      changedFiles: ["apps/desktop/src/renderer/App.tsx"],
      askScopePaths: [
        "apps/desktop/src/renderer/App.tsx",
        "apps/desktop/src/shared/settings.ts",
      ],
      userPrompt:
        "upon clicking Index settings its should redirect properly to semantic tab",
    });

    expect(prompt).toContain("No new ask-scoped diagnostics remain");
    expect(prompt).toContain("User ask");
    expect(prompt).toContain("Compare-only repair");
    expect(prompt).not.toContain("EventEmitter");
    expect(prompt).not.toContain("packages/other");
    expect(prompt).not.toContain("New ask-scoped errors (fix these exact items");
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
