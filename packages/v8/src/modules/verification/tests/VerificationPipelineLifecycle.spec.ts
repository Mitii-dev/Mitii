import { describe, expect, it } from "vitest";

import { InMemoryManifestReader, InMemoryVerificationRecordStore } from "..";
import { VerificationPipeline } from "../flow/VerificationPipeline";
import { baseVerificationInput, createVerificationGrant } from "./fixtures/grants";
import { createTools, toolResult } from "./fixtures/pipelineTools";

describe("VerificationPipeline scope and lifecycle", () => {
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

    expect(result.status).toBe("implemented_unverified");
    expect(result.status).not.toBe("verified_success");
    expect(result.reasonCodes).toContain("checks_unavailable");
  });

  it("persists and reloads a durable verification record", async () => {
    const store = new InMemoryVerificationRecordStore();
    const pipeline = new VerificationPipeline({
      tools: createTools(() => {
        throw new Error("should not run");
      }),
      manifests: new InMemoryManifestReader(),
      records: store,
    });
    const record = pipeline.buildRecord({
      runId: "run_pipe",
      requestId: "req_pipe",
      workspaceId: "ws_pipe",
      status: "incomplete",
    });
    await pipeline.persistRecord(record);
    const loaded = await pipeline.loadLatestRecord("ws_pipe");
    expect(loaded?.recordId).toBe("run_pipe");
    expect(loaded?.retry?.kind).toBe("fix_remaining");
    // Record has no changed files: the summary must not claim edits were kept.
    const summary = pipeline.buildUserSummary(record);
    expect(summary.toLowerCase()).toContain("no workspace edits");
    expect(summary.toLowerCase()).not.toContain("edits were kept");
  });
});
