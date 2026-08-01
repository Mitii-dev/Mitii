import { describe, expect, it } from "vitest";

import {
  InMemoryFileSystemAdapter,
  InMemoryProcessAdapter,
  MUTATION_TOOL_IDS,
  ToolRuntimePipeline,
  directory,
  file,
  validateMutationBatch,
  MutationBatchValidationError,
  DEFAULT_FALLBACK_MUTATION_BUDGET,
} from "../index";
import { createReadOnlyGrant } from "./fixtures/grants";
import type { ToolGrant } from "../../../modules/decision-policy";

const WORKSPACE = "/workspace";

function createWriteGrant(overrides: Partial<ToolGrant> = {}): ToolGrant {
  return {
    maximumWorkspaceEffect: "write",
    allowedTools: [
      ...createReadOnlyGrant().allowedTools,
      ...MUTATION_TOOL_IDS,
    ],
    allowedEffects: [
      "workspace_read",
      "workspace_write",
      "process_execute",
    ],
    pathScopes: ["."],
    approvalMode: "never",
    limits: {
      maxToolCalls: 24,
      maxWallTimeMs: 90_000,
      maxOutputBytes: 256_000,
      maxConcurrentTools: 1,
    },
    mutationBudget: { ...DEFAULT_FALLBACK_MUTATION_BUDGET },
    ...overrides,
  };
}

function createRuntime() {
  return new ToolRuntimePipeline({
    fileSystem: new InMemoryFileSystemAdapter(
      WORKSPACE,
      directory({
        src: directory({
          "a.ts": file("const a = 1;\n"),
          "b.ts": file("const b = 1;\n"),
          "c.ts": file("const c = 1;\n"),
          "d.ts": file("const d = 1;\n"),
        }),
      }),
    ),
    process: new InMemoryProcessAdapter(async () => ({
      exitCode: 0,
      stdout: "",
      stderr: "",
      timedOut: false,
      cancelled: false,
      truncated: false,
    })),
  });
}

describe("validateMutationBatch", () => {
  it("rejects too many patches against grant budget", () => {
    const grant = createWriteGrant({
      mutationBudget: {
        maxPatchesPerCall: 2,
        maxUniqueFilesPerCall: 5,
        maxPatchPayloadCharacters: 24_000,
        preferredBatchSize: 2,
        requireBatchedExecution: true,
      },
    });

    expect(() =>
      validateMutationBatch({
        toolName: "apply_patch",
        grant,
        arguments: {
          patches: [
            { path: "src/a.ts", oldText: "a", newText: "A" },
            { path: "src/b.ts", oldText: "b", newText: "B" },
            { path: "src/c.ts", oldText: "c", newText: "C" },
          ],
        },
      }),
    ).toThrow(MutationBatchValidationError);
  });

  it("rejects oversized payload characters", () => {
    const grant = createWriteGrant({
      mutationBudget: {
        maxPatchesPerCall: 8,
        maxUniqueFilesPerCall: 5,
        maxPatchPayloadCharacters: 20,
        preferredBatchSize: 2,
        requireBatchedExecution: false,
      },
    });

    expect(() =>
      validateMutationBatch({
        toolName: "apply_patch",
        grant,
        arguments: {
          patches: [
            {
              path: "src/a.ts",
              oldText: "x".repeat(15),
              newText: "y".repeat(15),
            },
          ],
        },
      }),
    ).toThrow(/payload/i);
  });

  it("allows batches within the grant budget", () => {
    expect(() =>
      validateMutationBatch({
        toolName: "apply_patch",
        grant: createWriteGrant(),
        arguments: {
          patches: [
            { path: "src/a.ts", oldText: "const a = 1;\n", newText: "const a = 2;\n" },
          ],
        },
      }),
    ).not.toThrow();
  });
});

describe("ToolRuntimePipeline mutation batch limits", () => {
  it("rejects oversized apply_patch at preflight with limit_exceeded", async () => {
    const runtime = createRuntime();
    const result = await runtime.execute({
      schemaVersion: 1,
      callId: "batch_1",
      toolName: "apply_patch",
      arguments: {
        patches: [
          { path: "src/a.ts", oldText: "const a = 1;\n", newText: "const a = 2;\n" },
          { path: "src/b.ts", oldText: "const b = 1;\n", newText: "const b = 2;\n" },
          { path: "src/c.ts", oldText: "const c = 1;\n", newText: "const c = 2;\n" },
          { path: "src/d.ts", oldText: "const d = 1;\n", newText: "const d = 2;\n" },
        ],
      },
      grant: createWriteGrant({
        mutationBudget: {
          maxPatchesPerCall: 2,
          maxUniqueFilesPerCall: 2,
          maxPatchPayloadCharacters: 24_000,
          preferredBatchSize: 2,
          requireBatchedExecution: true,
        },
      }),
      workspaceRoot: WORKSPACE,
    });

    expect(result.status).toBe("rejected");
    expect(result.reasonCode).toBe("limit_exceeded");
  });
});
