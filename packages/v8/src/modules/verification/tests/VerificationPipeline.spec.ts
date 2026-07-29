import { describe, expect, it, vi } from "vitest";

import type { ToolInvocationInput, ToolResult } from "../../../engine/tool-runtime";
import { TOOL_RUNTIME_SCHEMA_VERSION } from "../../../engine/tool-runtime";

import { InMemoryManifestReader } from "..";
import type { VerificationToolExecutorPort } from "../contracts";
import { VerificationError } from "../contracts";
import { VerificationPipeline } from "../pipeline/VerificationPipeline";
import { baseVerificationInput, createVerificationGrant } from "./fixtures/grants";

function toolResult(
  partial: Partial<ToolResult> & Pick<ToolResult, "callId" | "toolName" | "status">,
): ToolResult {
  return {
    schemaVersion: TOOL_RUNTIME_SCHEMA_VERSION,
    truncated: false,
    redacted: false,
    durationMs: 5,
    bytesProduced: 0,
    warnings: [],
    audit: {
      callId: partial.callId,
      toolName: partial.toolName,
      startedAt: new Date().toISOString(),
      endedAt: new Date().toISOString(),
      status: partial.status,
      inputPreview: "{}",
      bytesProduced: 0,
      durationMs: 5,
      truncated: false,
      redacted: false,
    },
    ...partial,
  };
}

function createTools(
  handler: (input: ToolInvocationInput) => ToolResult | Promise<ToolResult>,
): VerificationToolExecutorPort {
  return {
    execute: vi.fn(async (input) => handler(input)),
  };
}

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

  it("infers nested package checks and treats tsc build scripts as typecheck evidence", async () => {
    const manifests = new InMemoryManifestReader({
      "ai-service/package.json": JSON.stringify({
        scripts: {
          build: "pnpm exec tsc",
        },
        packageManager: "pnpm@10.13.1",
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
          minimumEvidence: ["diagnostics", "typecheck", "diff_review"],
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
    expect(result.status).not.toBe("verified_success");
    expect(
      result.warnings.some((warning) => warning.includes("no discoverable")),
    ).toBe(true);
  });

  it("expands checks for public_api scope across projects", async () => {
    const manifests = new InMemoryManifestReader({
      "package.json": JSON.stringify({
        scripts: { test: "vitest run", build: "tsc -p ." },
      }),
      "packages/api/package.json": JSON.stringify({
        scripts: { test: "vitest run", build: "tsc -p ." },
      }),
    });

    const tools = createTools((input) =>
      toolResult({
        callId: input.callId,
        toolName: input.toolName,
        status: "succeeded",
        output:
          input.toolName === "run_readonly_command"
            ? {
                argv: (input.arguments as { argv: string[] }).argv,
                exitCode: 0,
                stdout: "ok",
                stderr: "",
                truncated: false,
              }
            : input.toolName === "read_diagnostics"
              ? { diagnostics: [] }
              : { staged: [], unstaged: [], untracked: [], truncated: false },
      }),
    );

    const result = await new VerificationPipeline({
      tools,
      manifests,
    }).verify(
      baseVerificationInput({
        changeScope: "public_api",
        changedFiles: ["packages/api/src/index.ts"],
        projects: [
          {
            projectId: "root",
            rootPath: ".",
            primaryLanguageId: "typescript",
            manifestPaths: ["package.json"],
          },
          {
            projectId: "api",
            rootPath: "packages/api",
            primaryLanguageId: "typescript",
            manifestPaths: ["packages/api/package.json"],
          },
        ],
      }),
    );

    expect(result.reasonCodes).toContain("expanded_scope_selected");
    expect(result.affectedProjectIds).toEqual(
      expect.arrayContaining(["root", "api"]),
    );
    expect(result.checks.some((check) => check.kind === "build")).toBe(true);
  });

  it("cancels remaining checks when signal aborts", async () => {
    const manifests = new InMemoryManifestReader({
      "package.json": JSON.stringify({
        scripts: { typecheck: "tsc -p .", test: "vitest run" },
      }),
    });
    const controller = new AbortController();
    let calls = 0;
    const tools = createTools((input) => {
      calls += 1;
      if (calls === 1) {
        controller.abort();
        return toolResult({
          callId: input.callId,
          toolName: input.toolName,
          status: "cancelled",
        });
      }
      return toolResult({
        callId: input.callId,
        toolName: input.toolName,
        status: "succeeded",
        output: { diagnostics: [] },
      });
    });

    const result = await new VerificationPipeline({
      tools,
      manifests,
    }).verify(baseVerificationInput(), { signal: controller.signal });

    expect(result.status).toBe("cancelled");
    expect(result.checks.some((check) => check.outcome === "cancelled")).toBe(
      true,
    );
  });

  it("marks timed-out checks as verification_failed, not success", async () => {
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
          status: "timed_out",
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
    }).verify(baseVerificationInput());

    expect(result.status).toBe("verification_failed");
    expect(result.reasonCodes).toContain("checks_timed_out");
  });

  it("rejects when required tools are not granted", async () => {
    const manifests = new InMemoryManifestReader({
      "package.json": JSON.stringify({
        scripts: { test: "vitest run" },
      }),
    });
    const tools = createTools(() => {
      throw new Error("should not execute ungated tools");
    });

    const result = await new VerificationPipeline({
      tools,
      manifests,
    }).verify(
      baseVerificationInput({
        grant: createVerificationGrant({
          allowedTools: ["read_file", "list_directory"],
        }),
        verification: {
          required: true,
          minimumEvidence: ["tests"],
          allowUnavailable: false,
        },
      }),
    );

    expect(["blocked", "implemented_unverified"]).toContain(result.status);
    expect(result.status).not.toBe("verified_success");
  });
});
