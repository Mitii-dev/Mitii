import { describe, expect, it } from "vitest";

import {
  AgentEnginePipeline,
  agentEngineStartInputSchema,
} from "..";
import {
  createCapabilities,
  createDecision,
  createReadOnlyGrant,
  createStubDependencies,
  ScriptedLlmPort,
} from "./fixtures/stubs";
import {
  TOOL_RUNTIME_SCHEMA_VERSION,
  type ToolResult,
} from "../../tool-runtime";

function readCall(id: string) {
  return {
    id,
    name: "read_file",
    arguments: JSON.stringify({ path: "src/form.ts" }),
  };
}

function readPathCall(id: string, path: string) {
  return {
    id,
    name: "read_file",
    arguments: JSON.stringify({ path }),
  };
}

function patchCall(id: string) {
  return {
    id,
    name: "apply_patch",
    arguments: JSON.stringify({
      patches: [
        {
          path: "src/form.ts",
          oldText: "old",
          newText: "new",
        },
      ],
    }),
  };
}

function listDirectoryCall(id: string, path = "src") {
  return {
    id,
    name: "list_directory",
    arguments: JSON.stringify({ path }),
  };
}

describe("AgentEnginePipeline stall and read dedup", () => {
  it("dedups identical reads and stops after a re-read stall nudge", async () => {
    let executeCalls = 0;
    const deps = createStubDependencies({
      decision: createDecision({
        route: "repository_answer",
        toolGrant: createReadOnlyGrant({
          allowedTools: ["read_file"],
        }),
        reasonCodes: ["repository_grounded_answer"],
      }),
      llm: new ScriptedLlmPort(
        [
          {
            toolCalls: Array.from({ length: 8 }, (_, index) =>
              readCall(`call_read_${index}`),
            ),
          },
          {
            toolCalls: [readCall("call_read_again")],
          },
          { content: "Should not be reached after the stall break." },
        ],
        createCapabilities({ supportsTools: true }),
      ),
    });
    const originalExecute = deps.tools!.execute.bind(deps.tools);
    deps.tools = {
      ...deps.tools!,
      execute: async (input, options) => {
        executeCalls += 1;
        return originalExecute(input, options);
      },
    };

    const engine = new AgentEnginePipeline(deps);
    const result = await engine.start(
      agentEngineStartInputSchema.parse({
        schemaVersion: 1,
        request: {
          sessionId: "sess_stall",
          mode: "ask",
          userMessage: "What does the form helper return?",
          workspace: { workspaceId: "ws_1" },
        },
        workspaceRoot: "/workspace",
      }),
    ).result;

    expect(result.status).toBe("completed");
    expect(result.reasonCodes).toContain("tool_result_deduped");
    expect(result.reasonCodes).toContain("exploration_reread_heavy");
    expect(result.reasonCodes).toContain("exploration_stall_broken");
    expect(executeCalls).toBe(1);
    expect(result.usage.fileReadCalls).toBeGreaterThanOrEqual(8);
    expect(result.usage.uniqueFilePathsTouched).toBe(1);
    expect(result.answer ?? "").not.toContain("Should not be reached");
  });

  it("fails mutation runs that keep re-reading without edits", async () => {
    const deps = createStubDependencies({
      decision: createDecision({
        route: "execute",
        toolGrant: createReadOnlyGrant({
          maximumWorkspaceEffect: "write",
          allowedTools: ["read_file", "apply_patch"],
          allowedEffects: ["workspace_read", "workspace_write"],
          approvalMode: "never",
        }),
        reasonCodes: ["mutation_execute"],
      }),
      llm: new ScriptedLlmPort(
        [
          {
            content: "I need to inspect the form first.",
            toolCalls: Array.from({ length: 8 }, (_, index) =>
              readCall(`call_read_${index}`),
            ),
          },
          {
            content: "I still need the same file.",
            toolCalls: [readCall("call_read_again")],
          },
          { content: "Should not be reached after the mutation stall." },
        ],
        createCapabilities({ supportsTools: true }),
      ),
    });

    const engine = new AgentEnginePipeline(deps);
    const result = await engine.start(
      agentEngineStartInputSchema.parse({
        schemaVersion: 1,
        request: {
          sessionId: "sess_mutation_stall",
          mode: "agent",
          userMessage: "Fix all TypeScript errors",
          workspace: { workspaceId: "ws_1" },
        },
        workspaceRoot: "/workspace",
      }),
    ).result;

    expect(result.status).toBe("failed");
    expect(result.reasonCodes).toContain("exploration_stall_broken");
    expect(result.reasonCodes).toContain("unfulfilled_execute_exhausted");
    expect(result.reasonCodes).not.toContain("mutation_applied");
    expect(result.error?.code).toBe("no_mutation_performed");
    expect(result.answer ?? "").not.toContain("I still need the same file");
  });

  it("gives one grace turn after the first-mutation nudge, then fails if reading continues", async () => {
    const deps = createStubDependencies({
      decision: createDecision({
        route: "execute",
        toolGrant: createReadOnlyGrant({
          maximumWorkspaceEffect: "write",
          allowedTools: ["read_file", "apply_patch"],
          allowedEffects: ["workspace_read", "workspace_write"],
          approvalMode: "never",
        }),
        reasonCodes: ["mutation_execute"],
      }),
      llm: new ScriptedLlmPort(
        [
          ...Array.from({ length: 6 }, (_, index) => ({
            toolCalls: [
              readPathCall(`call_read_${index}`, `src/file-${index}.ts`),
            ],
          })),
          {
            content: "I still want to inspect one more file.",
            toolCalls: [readPathCall("call_read_after_nudge", "src/final.ts")],
          },
          {
            content: "I need to re-check that file once more.",
            toolCalls: [
              readPathCall("call_read_after_grace", "src/final-2.ts"),
            ],
          },
          { content: "Should not be reached after read-only execute drift." },
        ],
        createCapabilities({ supportsTools: true }),
      ),
    });

    const engine = new AgentEnginePipeline(deps);
    const result = await engine.start(
      agentEngineStartInputSchema.parse({
        schemaVersion: 1,
        request: {
          sessionId: "sess_mutation_read_only_drift",
          mode: "agent",
          userMessage: "Fix all TypeScript errors",
          workspace: { workspaceId: "ws_1" },
        },
        workspaceRoot: "/workspace",
      }),
    ).result;

    expect(result.status).toBe("failed");
    expect(result.reasonCodes).toContain("unfulfilled_execute_recovered");
    expect(result.reasonCodes).toContain("unfulfilled_execute_exhausted");
    expect(result.reasonCodes).not.toContain("mutation_applied");
    expect(result.error?.code).toBe("no_mutation_performed");
    expect(result.error?.message).toContain("continued reading");
    expect(result.answer ?? "").not.toContain("Should not be reached");
  });

  it("succeeds if the model mutates during the grace turn after the first-mutation nudge", async () => {
    const deps = createStubDependencies({
      decision: createDecision({
        route: "execute",
        toolGrant: createReadOnlyGrant({
          maximumWorkspaceEffect: "write",
          allowedTools: ["read_file", "apply_patch"],
          allowedEffects: ["workspace_read", "workspace_write"],
          approvalMode: "never",
        }),
        reasonCodes: ["mutation_execute"],
      }),
      llm: new ScriptedLlmPort(
        [
          ...Array.from({ length: 6 }, (_, index) => ({
            toolCalls: [
              readPathCall(`call_read_${index}`, `src/file-${index}.ts`),
            ],
          })),
          {
            content: "I still want to inspect one more file first.",
            toolCalls: [readPathCall("call_read_after_nudge", "src/final.ts")],
          },
          {
            content: "Applying the fix now.",
            toolCalls: [patchCall("call_patch_after_grace")],
          },
          { content: "Done." },
        ],
        createCapabilities({ supportsTools: true }),
      ),
    });

    const engine = new AgentEnginePipeline(deps);
    const result = await engine.start(
      agentEngineStartInputSchema.parse({
        schemaVersion: 1,
        request: {
          sessionId: "sess_mutation_read_only_drift_recovered",
          mode: "agent",
          userMessage: "Fix all TypeScript errors",
          workspace: { workspaceId: "ws_1" },
        },
        workspaceRoot: "/workspace",
      }),
    ).result;

    expect(result.reasonCodes).toContain("unfulfilled_execute_recovered");
    expect(result.status).not.toBe("failed");
    expect(result.error?.code).not.toBe("no_mutation_performed");
  });

  it("fails immediately when a rejected mutation is followed by more reading", async () => {
    const deps = createStubDependencies({
      decision: createDecision({
        route: "execute",
        toolGrant: createReadOnlyGrant({
          maximumWorkspaceEffect: "write",
          allowedTools: ["read_file", "apply_patch"],
          allowedEffects: ["workspace_read", "workspace_write"],
          approvalMode: "never",
        }),
        reasonCodes: ["mutation_execute"],
      }),
      llm: new ScriptedLlmPort(
        [
          {
            toolCalls: [patchCall("call_patch_rejected")],
          },
          {
            content: "I need to inspect the file again.",
            toolCalls: [readCall("call_read_after_reject")],
          },
          { content: "Should not be reached after rejected mutation drift." },
        ],
        createCapabilities({ supportsTools: true }),
      ),
      toolResults: {
        apply_patch: {
          status: "rejected",
          reasonCode: "effect_not_granted",
          warnings: ["workspace write was not granted"],
        },
      },
    });

    const engine = new AgentEnginePipeline(deps);
    const result = await engine.start(
      agentEngineStartInputSchema.parse({
        schemaVersion: 1,
        request: {
          sessionId: "sess_rejected_mutation_read",
          mode: "agent",
          userMessage: "Fix the type error",
          workspace: { workspaceId: "ws_1" },
        },
        workspaceRoot: "/workspace",
      }),
    ).result;

    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe("no_mutation_performed");
    expect(result.error?.message).toContain("rejected mutation");
    expect(result.reasonCodes).toContain("tool_failed");
    expect(result.reasonCodes).toContain("unfulfilled_execute_exhausted");
    expect(result.usage.modelCalls).toBe(2);
    expect(result.answer ?? "").not.toContain("Should not be reached");
  });

  it("allows one targeted discovery after a recoverable rejected mutation", async () => {
    const deps = createStubDependencies({
      decision: createDecision({
        route: "execute",
        toolGrant: createReadOnlyGrant({
          maximumWorkspaceEffect: "write",
          allowedTools: ["list_directory", "apply_patch"],
          allowedEffects: ["workspace_read", "workspace_write"],
          approvalMode: "never",
        }),
        reasonCodes: ["mutation_execute"],
      }),
      llm: new ScriptedLlmPort(
        [
          {
            toolCalls: [patchCall("call_patch_rejected")],
          },
          {
            content: "I need the exact file name.",
            toolCalls: [listDirectoryCall("call_list_types")],
          },
          {
            toolCalls: [patchCall("call_patch_corrected")],
          },
          { content: "Fixed the type error." },
        ],
        createCapabilities({ supportsTools: true }),
      ),
    });
    const originalExecute = deps.tools!.execute.bind(deps.tools);
    let patchAttempts = 0;
    deps.tools = {
      ...deps.tools!,
      execute: async (input, options): Promise<ToolResult> => {
        if (input.toolName !== "apply_patch") {
          return originalExecute(input, options);
        }

        patchAttempts += 1;
        if (patchAttempts === 1) {
          return {
            schemaVersion: TOOL_RUNTIME_SCHEMA_VERSION,
            callId: input.callId,
            toolName: input.toolName,
            status: "rejected",
            reasonCode: "patch_conflict",
            truncated: false,
            redacted: false,
            durationMs: 1,
            bytesProduced: 0,
            warnings: [
              'File not found for patch path "src/form-schema-type.ts" and oldText is non-empty.',
            ],
            audit: {
              callId: input.callId,
              toolName: input.toolName,
              startedAt: "2026-07-25T12:00:00.000Z",
              endedAt: "2026-07-25T12:00:00.001Z",
              status: "rejected",
              reasonCode: "patch_conflict",
              inputPreview: "{}",
              outputPreview: "{}",
              bytesProduced: 0,
              durationMs: 1,
              truncated: false,
              redacted: false,
            },
          };
        }

        return {
          schemaVersion: TOOL_RUNTIME_SCHEMA_VERSION,
          callId: input.callId,
          toolName: input.toolName,
          status: "succeeded",
          truncated: false,
          redacted: false,
          durationMs: 1,
          bytesProduced: 24,
          warnings: [],
          output: {
            checkpointId: "ckpt_corrected",
            changedFiles: ["src/form.ts"],
          },
          audit: {
            callId: input.callId,
            toolName: input.toolName,
            startedAt: "2026-07-25T12:00:00.000Z",
            endedAt: "2026-07-25T12:00:00.001Z",
            status: "succeeded",
            inputPreview: "{}",
            outputPreview:
              '{"checkpointId":"ckpt_corrected","changedFiles":["src/form.ts"]}',
            bytesProduced: 24,
            durationMs: 1,
            truncated: false,
            redacted: false,
          },
        };
      },
    };

    const engine = new AgentEnginePipeline(deps);
    const result = await engine.start(
      agentEngineStartInputSchema.parse({
        schemaVersion: 1,
        request: {
          sessionId: "sess_rejected_mutation_targeted_discovery",
          mode: "agent",
          userMessage: "Fix the type error",
          workspace: { workspaceId: "ws_1" },
        },
        workspaceRoot: "/workspace",
      }),
    ).result;

    expect(result.status).toBe("completed");
    expect(result.reasonCodes).toContain("mutation_applied");
    expect(result.warnings).toContain(
      "Allowed targeted stale-patch discovery after a recoverable rejected mutation.",
    );
    expect(patchAttempts).toBe(2);
  });

  it("allows bounded stale-patch reads across turns after a patch conflict", async () => {
    const deps = createStubDependencies({
      decision: createDecision({
        route: "execute",
        toolGrant: createReadOnlyGrant({
          maximumWorkspaceEffect: "write",
          allowedTools: ["read_file", "apply_patch"],
          allowedEffects: ["workspace_read", "workspace_write"],
          approvalMode: "never",
          mutationBudget: {
            maxPatchesPerCall: 6,
            maxUniqueFilesPerCall: 4,
            maxPatchPayloadCharacters: 24_000,
            preferredBatchSize: 3,
            requireBatchedExecution: false,
          },
        }),
        reasonCodes: ["mutation_execute"],
      }),
      llm: new ScriptedLlmPort(
        [
          {
            toolCalls: [patchCall("call_patch_rejected")],
          },
          {
            toolCalls: [readPathCall("call_read_primary", "src/form.ts")],
          },
          {
            toolCalls: [
              readPathCall("call_read_peer_a", "src/field-a.ts"),
              readPathCall("call_read_peer_b", "src/field-b.ts"),
              readPathCall("call_read_common", "src/common.ts"),
            ],
          },
          {
            toolCalls: [patchCall("call_patch_corrected")],
          },
          { content: "Fixed the stale patch conflict." },
        ],
        createCapabilities({ supportsTools: true }),
      ),
    });
    const originalExecute = deps.tools!.execute.bind(deps.tools);
    let patchAttempts = 0;
    deps.tools = {
      ...deps.tools!,
      execute: async (input, options): Promise<ToolResult> => {
        if (input.toolName !== "apply_patch") {
          return originalExecute(input, options);
        }
        patchAttempts += 1;
        if (patchAttempts === 1) {
          return {
            schemaVersion: TOOL_RUNTIME_SCHEMA_VERSION,
            callId: input.callId,
            toolName: input.toolName,
            status: "rejected",
            reasonCode: "patch_conflict",
            truncated: false,
            redacted: false,
            durationMs: 1,
            bytesProduced: 0,
            warnings: ['oldText not found in "src/form.ts".'],
            audit: {
              callId: input.callId,
              toolName: input.toolName,
              startedAt: "2026-07-25T12:00:00.000Z",
              endedAt: "2026-07-25T12:00:00.001Z",
              status: "rejected",
              reasonCode: "patch_conflict",
              inputPreview: "{}",
              outputPreview: "{}",
              bytesProduced: 0,
              durationMs: 1,
              truncated: false,
              redacted: false,
            },
          };
        }
        return {
          schemaVersion: TOOL_RUNTIME_SCHEMA_VERSION,
          callId: input.callId,
          toolName: input.toolName,
          status: "succeeded",
          truncated: false,
          redacted: false,
          durationMs: 1,
          bytesProduced: 24,
          warnings: [],
          output: {
            checkpointId: "ckpt_corrected",
            changedFiles: ["src/form.ts"],
          },
          audit: {
            callId: input.callId,
            toolName: input.toolName,
            startedAt: "2026-07-25T12:00:00.000Z",
            endedAt: "2026-07-25T12:00:00.001Z",
            status: "succeeded",
            inputPreview: "{}",
            outputPreview:
              '{"checkpointId":"ckpt_corrected","changedFiles":["src/form.ts"]}',
            bytesProduced: 24,
            durationMs: 1,
            truncated: false,
            redacted: false,
          },
        };
      },
    };

    const engine = new AgentEnginePipeline(deps);
    const result = await engine.start(
      agentEngineStartInputSchema.parse({
        schemaVersion: 1,
        request: {
          sessionId: "sess_rejected_mutation_multi_turn_targeted_discovery",
          mode: "agent",
          userMessage: "Fix the type error",
          workspace: { workspaceId: "ws_1" },
        },
        workspaceRoot: "/workspace",
      }),
    ).result;

    expect(result.status).toBe("completed");
    expect(result.reasonCodes).toContain("mutation_applied");
    expect(result.warnings.filter((warning) =>
      warning.includes("targeted stale-patch discovery"),
    )).toHaveLength(2);
    expect(patchAttempts).toBe(2);
  });

  it("recovers once then fails when mutation runs only call rejected read tools", async () => {
    const deps = createStubDependencies({
      decision: createDecision({
        route: "execute",
        toolGrant: createReadOnlyGrant({
          maximumWorkspaceEffect: "write",
          allowedTools: ["read_file", "glob_files", "apply_patch"],
          allowedEffects: ["workspace_read", "workspace_write"],
          approvalMode: "never",
        }),
        reasonCodes: ["mutation_execute"],
      }),
      llm: new ScriptedLlmPort(
        [
          {
            toolCalls: [
              {
                id: "call_bad_read",
                name: "read_file",
                arguments: JSON.stringify({}),
              },
            ],
          },
          {
            toolCalls: [
              {
                id: "call_bad_glob",
                name: "glob_files",
                arguments: JSON.stringify({ pattern: "" }),
              },
            ],
          },
          { content: "Should not be reached after rejected read drift." },
        ],
        createCapabilities({ supportsTools: true }),
      ),
      toolResults: {
        read_file: {
          status: "rejected",
          reasonCode: "invalid_arguments",
          warnings: ["path is required"],
        },
        glob_files: {
          status: "rejected",
          reasonCode: "invalid_arguments",
          warnings: ["pattern is required"],
        },
      },
    });

    const engine = new AgentEnginePipeline(deps);
    const result = await engine.start(
      agentEngineStartInputSchema.parse({
        schemaVersion: 1,
        request: {
          sessionId: "sess_rejected_reads",
          mode: "agent",
          userMessage: "Fix the type error",
          workspace: { workspaceId: "ws_1" },
        },
        workspaceRoot: "/workspace",
      }),
    ).result;

    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe("no_mutation_performed");
    expect(result.error?.message).toContain("rejected tools");
    expect(result.reasonCodes).toContain("tool_failed");
    expect(result.reasonCodes).toContain("unfulfilled_execute_exhausted");
    expect(result.usage.modelCalls).toBe(2);
    expect(result.answer ?? "").not.toContain("Should not be reached");
  });
});
