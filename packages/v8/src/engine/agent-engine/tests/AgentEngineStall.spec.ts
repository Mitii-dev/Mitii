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

/** Standard band (≥50k) so assertions match base AGENT_ENGINE_THRESHOLDS. */
function stallCapabilities(
  overrides: Parameters<typeof createCapabilities>[0] = {},
) {
  return createCapabilities({
    contextWindowTokens: 75_000,
    ...overrides,
  });
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
        stallCapabilities({ supportsTools: true }),
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

  it("does not stall-break after a mutation when later reads hit already-seen paths", async () => {
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
            toolCalls: Array.from({ length: 8 }, (_, index) =>
              readCall(`call_read_before_${index}`),
            ),
          },
          { toolCalls: [patchCall("call_patch_after_reread")] },
          {
            toolCalls: Array.from({ length: 4 }, (_, index) =>
              readCall(`call_read_after_${index}`),
            ),
          },
          { content: "Patched remaining type errors." },
        ],
        stallCapabilities({ supportsTools: true }),
      ),
    });
    const originalExecute = deps.tools!.execute.bind(deps.tools);
    deps.tools = {
      ...deps.tools!,
      execute: async (input, options) => {
        if (input.toolName === "apply_patch") {
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
              checkpointId: "ckpt_after_reread",
              changedFiles: ["src/form.ts"],
            },
            audit: {
              callId: input.callId,
              toolName: input.toolName,
              startedAt: "2026-07-25T12:00:00.000Z",
              endedAt: "2026-07-25T12:00:00.001Z",
              status: "succeeded",
              inputPreview: "{}",
              outputPreview: "{}",
              bytesProduced: 24,
              durationMs: 1,
              truncated: false,
              redacted: false,
            },
          };
        }
        return originalExecute(input, options);
      },
    };

    const engine = new AgentEnginePipeline(deps);
    const result = await engine.start(
      agentEngineStartInputSchema.parse({
        schemaVersion: 1,
        request: {
          sessionId: "sess_repair_reread",
          mode: "agent",
          userMessage: "Fix all TypeScript errors",
          workspace: { workspaceId: "ws_1" },
        },
        workspaceRoot: "/workspace",
      }),
    ).result;

    expect(result.status).toBe("completed");
    expect(result.reasonCodes).toContain("mutation_applied");
    expect(result.reasonCodes).not.toContain("exploration_stall_broken");
    expect(result.answer ?? "").toContain("Patched remaining type errors.");
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
        stallCapabilities({ supportsTools: true }),
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

  it("gives two grace turns after the first-mutation nudge, then fails if reading continues", async () => {
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
          {
            content: "I still want one more read.",
            toolCalls: [
              readPathCall("call_read_after_second_grace", "src/final-3.ts"),
            ],
          },
          {
            content: "Ignoring the blocker ask; reading again.",
            toolCalls: [
              readPathCall("call_read_after_blocker_ask", "src/final-4.ts"),
            ],
          },
          { content: "Should not be reached after read-only execute drift." },
        ],
        stallCapabilities({ supportsTools: true }),
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

  it("completes with a clear blocker after the final no-tools recovery ask", async () => {
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
            content: "One more read.",
            toolCalls: [readPathCall("call_read_after_nudge", "src/final.ts")],
          },
          {
            content: "Grace read 1.",
            toolCalls: [readPathCall("call_read_grace_1", "src/final-2.ts")],
          },
          {
            content: "Grace read 2.",
            toolCalls: [readPathCall("call_read_grace_2", "src/final-3.ts")],
          },
          {
            content:
              "Blocker: cannot fix this in the workspace. Stripo.init requires API credentials and config params that are not present in this repo.",
          },
        ],
        stallCapabilities({ supportsTools: true }),
      ),
    });

    const engine = new AgentEnginePipeline(deps);
    const result = await engine.start(
      agentEngineStartInputSchema.parse({
        schemaVersion: 1,
        request: {
          sessionId: "sess_mutation_blocker_accepted",
          mode: "agent",
          userMessage: "Fix all TypeScript errors",
          workspace: { workspaceId: "ws_1" },
        },
        workspaceRoot: "/workspace",
      }),
    ).result;

    expect(result.status).not.toBe("failed");
    expect(result.error?.code).not.toBe("no_mutation_performed");
    expect(result.answer ?? "").toMatch(/Blocker:/i);
    expect(result.reasonCodes).toContain("unfulfilled_execute_recovered");
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
        stallCapabilities({ supportsTools: true }),
      ),
    });

    const originalExecute = deps.tools!.execute.bind(deps.tools);
    deps.tools = {
      ...deps.tools!,
      execute: async (input, options) => {
        if (input.toolName === "apply_patch") {
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
              checkpointId: "ckpt_after_grace",
              changedFiles: ["src/form.ts"],
            },
            audit: {
              callId: input.callId,
              toolName: input.toolName,
              startedAt: "2026-07-25T12:00:00.000Z",
              endedAt: "2026-07-25T12:00:00.001Z",
              status: "succeeded",
              inputPreview: "{}",
              outputPreview: "{}",
              bytesProduced: 24,
              durationMs: 1,
              truncated: false,
              redacted: false,
            },
          };
        }
        return originalExecute(input, options);
      },
    };

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

  it("still succeeds when the model patches on the second grace turn after the first-mutation nudge", async () => {
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
            content: "One more verification read.",
            toolCalls: [
              readPathCall("call_read_after_first_grace", "src/final-2.ts"),
            ],
          },
          {
            content: "Applying the fix now.",
            toolCalls: [patchCall("call_patch_after_second_grace")],
          },
          { content: "Done." },
        ],
        stallCapabilities({ supportsTools: true }),
      ),
    });

    const originalExecute = deps.tools!.execute.bind(deps.tools);
    deps.tools = {
      ...deps.tools!,
      execute: async (input, options) => {
        if (input.toolName === "apply_patch") {
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
              checkpointId: "ckpt_after_second_grace",
              changedFiles: ["src/form.ts"],
            },
            audit: {
              callId: input.callId,
              toolName: input.toolName,
              startedAt: "2026-07-25T12:00:00.000Z",
              endedAt: "2026-07-25T12:00:00.001Z",
              status: "succeeded",
              inputPreview: "{}",
              outputPreview: "{}",
              bytesProduced: 24,
              durationMs: 1,
              truncated: false,
              redacted: false,
            },
          };
        }
        return originalExecute(input, options);
      },
    };

    const engine = new AgentEnginePipeline(deps);
    const result = await engine.start(
      agentEngineStartInputSchema.parse({
        schemaVersion: 1,
        request: {
          sessionId: "sess_mutation_second_grace_recovered",
          mode: "agent",
          userMessage: "Fix all TypeScript errors",
          workspace: { workspaceId: "ws_1" },
        },
        workspaceRoot: "/workspace",
      }),
    ).result;

    expect(result.reasonCodes).toContain("unfulfilled_execute_recovered");
    expect(result.reasonCodes).toContain("mutation_applied");
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
        stallCapabilities({ supportsTools: true }),
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
        stallCapabilities({ supportsTools: true }),
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
            reasonCode: "patch_target_missing",
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
              reasonCode: "patch_target_missing",
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

  it("allows one targeted read after identical_old_and_new then a real patch", async () => {
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
            toolCalls: [patchCall("call_patch_noop")],
          },
          {
            toolCalls: [readCall("call_read_after_noop")],
          },
          {
            toolCalls: [patchCall("call_patch_real")],
          },
          { content: "Fixed the type error." },
        ],
        stallCapabilities({ supportsTools: true }),
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
            reasonCode: "identical_old_and_new",
            truncated: false,
            redacted: false,
            durationMs: 1,
            bytesProduced: 0,
            warnings: [
              'oldText and newText are identical for "src/form.ts" — this patch would not change the file.',
            ],
            output: {
              path: "src/form.ts",
              currentContent: "private readonly sidebar: SidebarComponent;\n",
            },
            audit: {
              callId: input.callId,
              toolName: input.toolName,
              startedAt: "2026-07-25T12:00:00.000Z",
              endedAt: "2026-07-25T12:00:00.001Z",
              status: "rejected",
              reasonCode: "identical_old_and_new",
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
            checkpointId: "ckpt_identical_retry",
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
              '{"checkpointId":"ckpt_identical_retry","changedFiles":["src/form.ts"]}',
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
          sessionId: "sess_identical_old_and_new_retry",
          mode: "agent",
          userMessage: "Fix the type error",
          workspace: { workspaceId: "ws_1" },
        },
        workspaceRoot: "/workspace",
      }),
    ).result;

    expect(result.status).toBe("completed");
    expect(result.reasonCodes).toContain("mutation_applied");
    expect(result.error?.code).not.toBe("no_mutation_performed");
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
        stallCapabilities({ supportsTools: true }),
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
            reasonCode: "old_text_not_found",
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
              reasonCode: "old_text_not_found",
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

  it("recovers a second stale apply_patch after targeted discovery (error-log no_mutation pattern)", async () => {
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
          { toolCalls: [patchCall("call_patch_stale_1")] },
          {
            toolCalls: [
              readPathCall("call_read_stale_target", "src/form.ts"),
            ],
          },
          { toolCalls: [patchCall("call_patch_stale_2")] },
          { toolCalls: [patchCall("call_patch_ok")] },
          { content: "Fixed after two stale hunk recoveries." },
        ],
        stallCapabilities({ supportsTools: true }),
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
        if (patchAttempts <= 2) {
          return {
            schemaVersion: TOOL_RUNTIME_SCHEMA_VERSION,
            callId: input.callId,
            toolName: input.toolName,
            status: "rejected",
            reasonCode: "old_text_not_found",
            truncated: false,
            redacted: false,
            durationMs: 1,
            bytesProduced: 0,
            warnings: [
              'oldText not found in "src/form.ts" — copy exact text from currentContent and retry.',
            ],
            audit: {
              callId: input.callId,
              toolName: input.toolName,
              startedAt: "2026-07-25T12:00:00.000Z",
              endedAt: "2026-07-25T12:00:00.001Z",
              status: "rejected",
              reasonCode: "old_text_not_found",
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
            checkpointId: "ckpt_double_stale",
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
              '{"checkpointId":"ckpt_double_stale","changedFiles":["src/form.ts"]}',
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
          sessionId: "sess_double_stale_patch_recovery",
          mode: "agent",
          userMessage: "Fix the type error",
          workspace: { workspaceId: "ws_1" },
        },
        workspaceRoot: "/workspace",
      }),
    ).result;

    expect(result.status).toBe("completed");
    expect(result.reasonCodes).toContain("mutation_applied");
    expect(result.error?.code).not.toBe("no_mutation_performed");
    expect(patchAttempts).toBe(3);
    expect(
      result.warnings.filter((warning) =>
        warning.includes("requesting a corrected edit"),
      ).length,
    ).toBeGreaterThanOrEqual(2);
  });

  it("recovers then fails when mutation runs only call rejected read tools", async () => {
    const deps = createStubDependencies({
      decision: createDecision({
        route: "execute",
        toolGrant: createReadOnlyGrant({
          maximumWorkspaceEffect: "write",
          allowedTools: ["read_file", "glob_files", "list_directory", "apply_patch"],
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
          {
            toolCalls: [
              {
                id: "call_bad_list",
                name: "list_directory",
                arguments: JSON.stringify({}),
              },
            ],
          },
          { content: "Should not be reached after rejected read drift." },
        ],
        stallCapabilities({ supportsTools: true }),
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
        list_directory: {
          status: "rejected",
          reasonCode: "invalid_arguments",
          warnings: ["path is required"],
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
    // Two recoveries (maxUnfulfilledExecuteRecoveries: 2), then fail on the third rejected turn.
    expect(result.usage.modelCalls).toBe(3);
    expect(result.answer ?? "").not.toContain("Should not be reached");
  });

  it("nudges after consecutive glob/search turns following a mutation", async () => {
    const deps = createStubDependencies({
      decision: createDecision({
        route: "execute",
        toolGrant: createReadOnlyGrant({
          maximumWorkspaceEffect: "write",
          allowedTools: ["glob_files", "apply_patch"],
          allowedEffects: ["workspace_read", "workspace_write"],
          approvalMode: "never",
        }),
        reasonCodes: ["mutation_execute"],
      }),
      llm: new ScriptedLlmPort(
        [
          { toolCalls: [patchCall("call_patch_first")] },
          {
            toolCalls: [
              {
                id: "call_glob_1",
                name: "glob_files",
                arguments: JSON.stringify({ pattern: "**/*.ts" }),
              },
            ],
          },
          {
            toolCalls: [
              {
                id: "call_glob_2",
                name: "glob_files",
                arguments: JSON.stringify({ pattern: "**/*.tsx" }),
              },
            ],
          },
          {
            toolCalls: [
              {
                id: "call_glob_3",
                name: "glob_files",
                arguments: JSON.stringify({ pattern: "**/*.js" }),
              },
            ],
          },
          { content: "Continuing after the glob stall nudge." },
        ],
        stallCapabilities({ supportsTools: true }),
      ),
    });
    const originalExecute = deps.tools!.execute.bind(deps.tools);
    deps.tools = {
      ...deps.tools!,
      execute: async (input, options): Promise<ToolResult> => {
        if (input.toolName === "apply_patch") {
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
              checkpointId: "ckpt_1",
              changedFiles: ["src/form.ts"],
            },
            audit: {
              callId: input.callId,
              toolName: input.toolName,
              startedAt: "2026-07-25T12:00:00.000Z",
              endedAt: "2026-07-25T12:00:00.001Z",
              status: "succeeded",
              inputPreview: "{}",
              outputPreview: "{}",
              bytesProduced: 24,
              durationMs: 1,
              truncated: false,
              redacted: false,
            },
          };
        }
        return originalExecute(input, options);
      },
    };

    const engine = new AgentEnginePipeline(deps);
    const result = await engine.start(
      agentEngineStartInputSchema.parse({
        schemaVersion: 1,
        request: {
          sessionId: "sess_post_mutation_glob_stall",
          mode: "agent",
          userMessage: "Fix all TypeScript errors",
          workspace: { workspaceId: "ws_1" },
        },
        workspaceRoot: "/workspace",
      }),
    ).result;

    expect(result.status).toBe("completed");
    expect(result.reasonCodes).toContain("mutation_applied");
    expect(result.reasonCodes).toContain("unfulfilled_execute_recovered");
    expect(result.warnings.some((warning) => warning.includes("reading after mutations"))).toBe(
      true,
    );
  });

  it("stops post-mutation globbing after one nudge so verification can run", async () => {
    const deps = createStubDependencies({
      decision: createDecision({
        route: "execute",
        toolGrant: createReadOnlyGrant({
          maximumWorkspaceEffect: "write",
          allowedTools: ["glob_files", "apply_patch"],
          allowedEffects: ["workspace_read", "workspace_write"],
          approvalMode: "never",
        }),
        reasonCodes: ["mutation_execute"],
      }),
      llm: new ScriptedLlmPort(
        [
          { toolCalls: [patchCall("call_patch_first")] },
          {
            toolCalls: [
              {
                id: "call_glob_1",
                name: "glob_files",
                arguments: JSON.stringify({ pattern: "**/*.ts" }),
              },
            ],
          },
          {
            toolCalls: [
              {
                id: "call_glob_2",
                name: "glob_files",
                arguments: JSON.stringify({ pattern: "**/*.tsx" }),
              },
            ],
          },
          {
            toolCalls: [
              {
                id: "call_glob_3",
                name: "glob_files",
                arguments: JSON.stringify({ pattern: "**/*.js" }),
              },
            ],
          },
          {
            toolCalls: [
              {
                id: "call_glob_4",
                name: "glob_files",
                arguments: JSON.stringify({ pattern: "**/*.mjs" }),
              },
            ],
          },
          {
            toolCalls: [
              {
                id: "call_glob_5",
                name: "glob_files",
                arguments: JSON.stringify({ pattern: "**/*.cjs" }),
              },
            ],
          },
          {
            toolCalls: [
              {
                id: "call_glob_6",
                name: "glob_files",
                arguments: JSON.stringify({ pattern: "**/*.cts" }),
              },
            ],
          },
          { content: "Should not keep globbing after the post-mutation cap." },
        ],
        stallCapabilities({ supportsTools: true }),
      ),
    });
    const originalExecute = deps.tools!.execute.bind(deps.tools);
    deps.tools = {
      ...deps.tools!,
      execute: async (input, options): Promise<ToolResult> => {
        if (input.toolName === "apply_patch") {
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
              checkpointId: "ckpt_1",
              changedFiles: ["src/form.ts"],
            },
            audit: {
              callId: input.callId,
              toolName: input.toolName,
              startedAt: "2026-07-25T12:00:00.000Z",
              endedAt: "2026-07-25T12:00:00.001Z",
              status: "succeeded",
              inputPreview: "{}",
              outputPreview: "{}",
              bytesProduced: 24,
              durationMs: 1,
              truncated: false,
              redacted: false,
            },
          };
        }
        return originalExecute(input, options);
      },
    };

    const engine = new AgentEnginePipeline(deps);
    const result = await engine.start(
      agentEngineStartInputSchema.parse({
        schemaVersion: 1,
        request: {
          sessionId: "sess_post_mutation_glob_cap",
          mode: "agent",
          userMessage: "Fix all TypeScript errors",
          workspace: { workspaceId: "ws_1" },
        },
        workspaceRoot: "/workspace",
      }),
    ).result;

    expect(result.status).toBe("completed");
    expect(result.reasonCodes).toContain("mutation_applied");
    expect(result.reasonCodes).toContain("unfulfilled_execute_recovered");
    expect(result.reasonCodes).toContain("post_mutation_read_capped");
    expect(result.answer ?? "").not.toContain(
      "Should not keep globbing after the post-mutation cap.",
    );
  });
});
