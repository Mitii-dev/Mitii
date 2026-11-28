import { describe, expect, it } from "vitest";

import { InMemoryManifestReader } from "..";
import { VerificationPipeline } from "../flow/VerificationPipeline";
import { baseVerificationInput } from "./fixtures/grants";
import { createTools, toolResult } from "./fixtures/pipelineTools";

describe("VerificationPipeline checks", () => {
  it("counts remaining errors only against prior error keys", () => {
    const pipeline = new VerificationPipeline({
      tools: {
        execute: async () => {
          throw new Error("not used");
        },
      },
      manifests: new InMemoryManifestReader({}),
    });
    const before = {
      schemaVersion: 1 as const,
      capturedAt: "2026-08-14T12:00:00.000Z",
      phase: "before" as const,
      scope: {
        workspaceRoot: "/repo",
        folderPrefixes: ["packages/mui-builder"],
        projectIds: ["mui-builder"],
        changeScope: "module" as const,
      },
      checks: [],
      diagnostics: [
        {
          path: "packages/mui-builder/src/Button.tsx",
          severity: "error" as const,
          message: "Type mismatch",
          startLine: 12,
          code: "TS2322",
        },
        {
          path: "packages/mui-builder/src/theme.ts",
          severity: "warning" as const,
          message: "Unused export",
          startLine: 3,
        },
      ],
      summary: {
        errorCount: 1,
        warningCount: 1,
        failedCheckIds: [],
      },
      reasonCodes: ["checks_failed" as const],
    };
    const after = {
      ...before,
      phase: "after" as const,
      diagnostics: [
        {
          path: "packages/mui-builder/src/Button.tsx",
          severity: "error" as const,
          message: "Type mismatch",
          startLine: 12,
          code: "TS2322",
        },
      ],
      summary: {
        errorCount: 1,
        warningCount: 0,
        failedCheckIds: [],
      },
    };

    const comparison = pipeline.compareBuildStates({ before, after });
    expect(comparison.remainingErrorCount).toBe(1);
    expect(comparison.newErrorCount).toBe(0);
    expect(comparison.reasonCodes).toContain("errors_remaining");
  });

  it("infers nested package checks and treats tsc build scripts as typecheck evidence", async () => {
    const manifests = new InMemoryManifestReader({
      "package.json": JSON.stringify({
        packageManager: "pnpm@10.13.1",
      }),
      "ai-service/package.json": JSON.stringify({
        scripts: {
          build: "pnpm exec tsc",
        },
      }),
    });

    const tools = createTools((input) => {
      if (input.toolName === "run_readonly_command") {
        return toolResult({
          callId: input.callId,
          toolName: input.toolName,
          status: "succeeded",
          output: {
            argv: (input.arguments as { argv: string[] }).argv,
            exitCode: 0,
            stdout: "ok",
            stderr: "",
            truncated: false,
          },
        });
      }
      return toolResult({
        callId: input.callId,
        toolName: input.toolName,
        status: "succeeded",
        output:
          input.toolName === "read_diagnostics"
            ? { diagnostics: [] }
            : {
                staged: [],
                unstaged: ["ai-service/src/app.ts"],
                untracked: [],
                diff: "diff --git a/ai-service/src/app.ts",
                truncated: false,
              },
      });
    });

    const result = await new VerificationPipeline({
      tools,
      manifests,
    }).verify(
      baseVerificationInput({
        changedFiles: ["ai-service/src/app.ts"],
        projects: [
          {
            projectId: "workspace-root",
            rootPath: ".",
            primaryLanguageId: "typescript",
            manifestPaths: [],
          },
        ],
        verification: {
          required: true,
          minimumEvidence: ["diagnostics", "tests", "typecheck", "diff_review"],
          allowUnavailable: false,
        },
      }),
    );

    expect(result.status).toBe("verified_success");
    expect(result.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "typecheck",
          argv: ["pnpm", "--dir", "ai-service", "run", "build"],
          outcome: "passed",
        }),
      ]),
    );
    expect(result.reasonCodes).toContain("checks_passed");
  });

  it("never treats failed checks as verified_success", async () => {
    const manifests = new InMemoryManifestReader({
      "package.json": JSON.stringify({
        scripts: { test: "vitest run" },
      }),
    });

    const tools = createTools((input) => {
      if (input.toolName === "run_readonly_command") {
        return toolResult({
          callId: input.callId,
          toolName: input.toolName,
          status: "succeeded",
          output: {
            argv: (input.arguments as { argv: string[] }).argv,
            exitCode: 1,
            stdout: "",
            stderr: "FAIL",
            truncated: false,
          },
        });
      }
      return toolResult({
        callId: input.callId,
        toolName: input.toolName,
        status: "succeeded",
        output:
          input.toolName === "read_diagnostics"
            ? { diagnostics: [] }
            : {
                staged: [],
                unstaged: [],
                untracked: [],
                truncated: false,
              },
      });
    });

    const result = await new VerificationPipeline({
      tools,
      manifests,
    }).verify(baseVerificationInput());

    expect(result.status).toBe("verification_failed");
    expect(result.reasonCodes).toContain("checks_failed");
  });

  it("degrades missing tools to unavailable without pretending success", async () => {
    const manifests = new InMemoryManifestReader({
      "package.json": JSON.stringify({
        scripts: { typecheck: "tsc -p ." },
      }),
    });

    const tools = createTools((input) => {
      if (input.toolName === "run_readonly_command") {
        return toolResult({
          callId: input.callId,
          toolName: input.toolName,
          status: "succeeded",
          output: {
            argv: (input.arguments as { argv: string[] }).argv,
            exitCode: 127,
            stdout: "",
            stderr: "tsc: command not found",
            truncated: false,
          },
        });
      }
      return toolResult({
        callId: input.callId,
        toolName: input.toolName,
        status: "succeeded",
        output:
          input.toolName === "read_diagnostics"
            ? { diagnostics: [] }
            : { staged: [], unstaged: [], untracked: [], truncated: false },
      });
    });

    const result = await new VerificationPipeline({
      tools,
      manifests,
    }).verify(
      baseVerificationInput({
        verification: {
          required: true,
          minimumEvidence: ["typecheck"],
          allowUnavailable: true,
        },
      }),
    );

    expect(result.status).toBe("implemented_unverified");
    expect(result.checks.some((check) => check.outcome === "unavailable")).toBe(
      true,
    );
    expect(result.reasonCodes).toContain("missing_tool_degraded");
  });

  it("does not invent a universal test command when manifests lack scripts", async () => {
    const manifests = new InMemoryManifestReader({
      "package.json": JSON.stringify({ name: "empty", scripts: {} }),
    });
    const tools = createTools((input) =>
      toolResult({
        callId: input.callId,
        toolName: input.toolName,
        status: "succeeded",
        output:
          input.toolName === "read_diagnostics"
            ? { diagnostics: [] }
            : { staged: [], unstaged: [], untracked: [], truncated: false },
      }),
    );

    const result = await new VerificationPipeline({
      tools,
      manifests,
    }).verify(
      baseVerificationInput({
        verification: {
          required: true,
          minimumEvidence: ["tests"],
          allowUnavailable: true,
        },
      }),
    );

    expect(result.checks.some((check) => check.kind === "test")).toBe(false);
    expect(result.status).toBe("implemented_unverified");
    expect(result.reasonCodes).toContain("checks_unavailable");
    expect(
      result.warnings.some((warning) => warning.includes("no discoverable")),
    ).toBe(true);
  });

  it("treats missing scripts as implemented_unverified even when allowUnavailable is false", async () => {
    const manifests = new InMemoryManifestReader({
      "package.json": JSON.stringify({ name: "empty", scripts: {} }),
    });
    const tools = createTools((input) =>
      toolResult({
        callId: input.callId,
        toolName: input.toolName,
        status: "succeeded",
        output:
          input.toolName === "read_diagnostics"
            ? { diagnostics: [] }
            : { staged: [], unstaged: [], untracked: [], truncated: false },
      }),
    );

    const result = await new VerificationPipeline({
      tools,
      manifests,
    }).verify(
      baseVerificationInput({
        verification: {
          required: true,
          minimumEvidence: ["diagnostics", "diff_review", "tests"],
          allowUnavailable: false,
        },
      }),
    );

    expect(result.status).toBe("implemented_unverified");
    expect(result.reasonCodes).toContain("checks_unavailable");
    expect(result.status).not.toBe("blocked");
    expect(
      result.checks.every(
        (check) =>
          check.outcome === "passed" || check.outcome === "unavailable",
      ),
    ).toBe(true);
  });
});
