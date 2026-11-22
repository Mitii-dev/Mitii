import { describe, expect, it } from "vitest";

import { InMemoryManifestReader } from "..";
import { VerificationError } from "../contracts";
import { VerificationPipeline } from "../pipeline/VerificationPipeline";
import { baseVerificationInput } from "./fixtures/grants";
import { createTools, toolResult } from "./fixtures/pipelineTools";

describe("VerificationPipeline", () => {
  it("rejects invalid input", async () => {
    const pipeline = new VerificationPipeline({
      tools: createTools(() => {
        throw new Error("should not run");
      }),
      manifests: new InMemoryManifestReader(),
    });

    await expect(
      pipeline.verify({
        ...baseVerificationInput(),
        schemaVersion: 2 as 1,
      }),
    ).rejects.toBeInstanceOf(VerificationError);
  });

  it("returns verified_success when verification is not required", async () => {
    const tools = createTools(() => {
      throw new Error("should not execute tools");
    });
    const pipeline = new VerificationPipeline({
      tools,
      manifests: new InMemoryManifestReader(),
    });

    const result = await pipeline.verify(
      baseVerificationInput({
        verification: {
          required: false,
          minimumEvidence: [],
          allowUnavailable: true,
        },
      }),
    );

    expect(result.status).toBe("verified_success");
    expect(result.reasonCodes).toContain("verification_not_required");
    expect(tools.execute).not.toHaveBeenCalled();
  });

  it("blocks when pinned state is unavailable", async () => {
    const pipeline = new VerificationPipeline({
      tools: createTools(() => {
        throw new Error("should not run");
      }),
      manifests: new InMemoryManifestReader(),
    });

    const result = await pipeline.verify(
      baseVerificationInput({ stateReadiness: "unavailable" }),
    );

    expect(result.status).toBe("blocked");
    expect(result.reasonCodes).toContain("state_unavailable");
  });

  it("discovers node scripts and verifies success through Tool Runtime", async () => {
    const manifests = new InMemoryManifestReader({
      "package.json": JSON.stringify({
        scripts: {
          typecheck: "tsc -p . --noEmit",
          test: "vitest run",
          lint: "eslint .",
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
      if (input.toolName === "read_diagnostics") {
        return toolResult({
          callId: input.callId,
          toolName: input.toolName,
          status: "succeeded",
          output: { diagnostics: [] },
        });
      }
      if (input.toolName === "read_git_status") {
        return toolResult({
          callId: input.callId,
          toolName: input.toolName,
          status: "succeeded",
          output: {
            staged: [],
            unstaged: ["src/app.ts"],
            untracked: [],
            diff: "diff --git a/src/app.ts",
            truncated: false,
          },
        });
      }
      return toolResult({
        callId: input.callId,
        toolName: input.toolName,
        status: "failed",
      });
    });

    const pipeline = new VerificationPipeline({ tools, manifests });
    const result = await pipeline.verify(baseVerificationInput());

    expect(result.status).toBe("verified_success");
    expect(result.reasonCodes).toContain("checks_passed");
    expect(result.checks.some((check) => check.kind === "typecheck")).toBe(
      true,
    );
    expect(result.checks.every((check) => check.outcome === "passed")).toBe(
      true,
    );
    expect(result.diff.reviewed).toBe(true);
    expect(tools.execute).toHaveBeenCalled();
  });

  it("filters pre-existing diagnostics from verification evidence", async () => {
    const tools = createTools((input) => {
      if (input.toolName === "read_diagnostics") {
        return toolResult({
          callId: input.callId,
          toolName: input.toolName,
          status: "succeeded",
          output: {
            diagnostics: [
              {
                path: "src/app.ts",
                severity: "error",
                message: "Existing unrelated error",
                startLine: 4,
                source: "tsserver",
                code: "TS1001",
              },
              {
                path: "src/app.ts",
                severity: "error",
                message: "New error from changed code",
                startLine: 8,
                source: "tsserver",
                code: "TS2339",
              },
            ],
          },
        });
      }
      if (input.toolName === "read_git_status") {
        return toolResult({
          callId: input.callId,
          toolName: input.toolName,
          status: "succeeded",
          output: {
            staged: [],
            unstaged: ["src/app.ts"],
            untracked: [],
            diff: "diff --git a/src/app.ts",
            truncated: false,
          },
        });
      }
      return toolResult({
        callId: input.callId,
        toolName: input.toolName,
        status: "succeeded",
        output: {
          argv: (input.arguments as { argv?: string[] }).argv ?? [],
          exitCode: 0,
          stdout: "ok",
          stderr: "",
          truncated: false,
        },
      });
    });

    const result = await new VerificationPipeline({
      tools,
      manifests: new InMemoryManifestReader(),
    }).verify(
      baseVerificationInput({
        baselineDiagnostics: [
          {
            path: "src/app.ts",
            severity: "error",
            message: "Existing unrelated error",
            startLine: 4,
            source: "tsserver",
            code: "TS1001",
          },
        ],
        verification: {
          required: true,
          minimumEvidence: ["diagnostics", "diff_review"],
          allowUnavailable: true,
        },
      }),
    );

    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        message: "New error from changed code",
        code: "TS2339",
      }),
    ]);
    expect(result.allDiagnostics).toHaveLength(2);
  });

  it("captures and compares repo build state snapshots", async () => {
    const tools = createTools((input) => {
      if (input.toolName === "read_diagnostics") {
        return toolResult({
          callId: input.callId,
          toolName: input.toolName,
          status: "succeeded",
          output: {
            diagnostics: [
              {
                path: "packages/mui-builder/src/Button.tsx",
                severity: "error",
                message: "Type mismatch",
                startLine: 12,
                source: "tsserver",
                code: "TS2322",
              },
            ],
          },
        });
      }
      if (input.toolName === "read_git_status") {
        return toolResult({
          callId: input.callId,
          toolName: input.toolName,
          status: "succeeded",
          output: {
            staged: [],
            unstaged: [],
            untracked: [],
            truncated: false,
          },
        });
      }
      return toolResult({
        callId: input.callId,
        toolName: input.toolName,
        status: "succeeded",
        output: {
          argv: (input.arguments as { argv?: string[] }).argv ?? [],
          exitCode: 1,
          stdout: "",
          stderr: "tsc failed",
          truncated: false,
        },
      });
    });
    const pipeline = new VerificationPipeline({
      tools,
      manifests: new InMemoryManifestReader({
        "packages/mui-builder/package.json": JSON.stringify({
          scripts: { typecheck: "tsc -p . --noEmit" },
        }),
      }),
    });

    const before = await pipeline.captureBuildState(
      baseVerificationInput({
        changedFiles: ["packages/mui-builder"],
        projects: [
          {
            projectId: "mui-builder",
            rootPath: "packages/mui-builder",
            primaryLanguageId: "typescript",
            manifestPaths: ["packages/mui-builder/package.json"],
          },
        ],
        changeScope: "module",
        verification: {
          required: true,
          minimumEvidence: ["diagnostics", "typecheck"],
          allowUnavailable: true,
        },
      }),
      { phase: "before", capturedAt: "2026-08-14T12:00:00.000Z" },
    );

    const after = {
      ...before,
      phase: "after" as const,
      diagnostics: [],
      summary: {
        errorCount: 0,
        warningCount: 0,
        failedCheckIds: [],
      },
    };
    const comparison = pipeline.compareBuildStates({ before, after });

    expect(before.summary.errorCount).toBe(1);
    expect(before.scope.projectIds).toEqual(["mui-builder"]);
    expect(before.scope.folderPrefixes).toEqual(["packages/mui-builder"]);
    expect(comparison.reasonCodes).toContain("errors_cleared");
    expect(comparison.clearedErrorCount).toBe(1);
    expect(comparison.remainingErrorCount).toBe(0);
  });

  it("does not execute desktop:test / WDIO unless tests evidence is required", async () => {
    const manifests = new InMemoryManifestReader({
      "package.json": JSON.stringify({
        scripts: {
          "desktop:test": "wdio run ./wdio.desktop.conf.ts",
        },
      }),
      "tsconfig.json": "{ \"compilerOptions\": { \"strict\": true } }",
    });
    const executed: string[][] = [];
    const tools = createTools((input) => {
      if (input.toolName === "run_readonly_command") {
        const argv = (input.arguments as { argv: string[] }).argv;
        executed.push(argv);
        return toolResult({
          callId: input.callId,
          toolName: input.toolName,
          status: "succeeded",
          output: {
            argv,
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
            : { staged: [], unstaged: [], untracked: [], truncated: false },
      });
    });

    await new VerificationPipeline({ tools, manifests }).captureBuildState(
      baseVerificationInput({
        changeScope: "cross_cutting",
        verification: {
          required: true,
          minimumEvidence: ["diagnostics", "typecheck", "build"],
          allowUnavailable: true,
        },
      }),
      { phase: "before" },
    );

    expect(executed.some((argv) => argv.includes("desktop:test"))).toBe(false);
    expect(executed.some((argv) => argv.includes("wdio"))).toBe(false);
  });
});
