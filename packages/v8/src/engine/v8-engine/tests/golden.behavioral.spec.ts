/**
 * Golden behavioral specs for v8-engine.
 */
import { describe, expect, it } from "vitest";

import {
  decideTruncationRecovery,
  discardIncompleteToolCalls,
  shouldForcePreflightRepairLock,
  truncationWarningMessage,
} from "../actions";
import { V8EnginePipeline } from "../pipeline/V8EnginePipeline";
import { InMemoryRunCheckpointStore } from "../../agent-engine/adapters";
import {
  createDecision,
  createReadOnlyGrant,
  createStubDependencies,
  ScriptedLlmPort,
} from "../../agent-engine/tests/fixtures/stubs";

describe("v8-engine golden — user paths vs preflight", () => {
  it("does not force preflight repair lock for a multi-test dump vs unrelated CSS diagnostics", () => {
    const prompt = [
      "The following Vitest failures need fixes:",
      "FAIL src/auth/login.spec.ts",
      "FAIL src/auth/session.spec.ts",
      "Please patch those specs and auth helpers.",
    ].join("\n");

    expect(
      shouldForcePreflightRepairLock({
        route: "execute",
        maximumWorkspaceEffect: "write",
        preflightErrorCount: 11,
        userPrompt: prompt,
        diagnosticPaths: [
          "src/styles/legacy-theme.css",
          "src/styles/tokens.css",
        ],
      }),
    ).toBe(false);
  });
});

describe("v8-engine golden — reasoning vs truncation messaging", () => {
  it("labels reasoning-budget cuts separately from max_tokens truncation", () => {
    const decision = decideTruncationRecovery({
      finishReason: "stop",
      reasoningBudgetExceeded: true,
      hasToolCalls: false,
      incompleteToolCalls: false,
      truncationRecoveriesUsed: 0,
      maxTruncationRecoveries: 3,
      requireMutation: true,
    });
    expect(decision.kind).toBe("reasoning_abort");
    expect(decision.message).not.toMatch(/output token limit/i);
    expect(
      truncationWarningMessage({ reasoningBudgetExceeded: true }),
    ).not.toMatch(/maximumOutputTokens|max_tokens/i);
  });

  it("discards incomplete truncated tool calls before settlement", () => {
    const { complete, discardedCount } = discardIncompleteToolCalls([
      {
        id: "ok",
        name: "apply_patch",
        arguments: JSON.stringify({
          patches: [{ path: "a.ts", oldText: "x", newText: "y" }],
        }),
      },
      {
        id: "bad",
        name: "apply_patch",
        arguments: '{"patches":[{"path":"a.ts","oldText":"',
      },
    ]);
    expect(discardedCount).toBe(1);
    expect(complete).toHaveLength(1);
    expect(complete[0]?.id).toBe("ok");
  });
});

describe("v8-engine golden — thin loop happy path", () => {
  it("mutation-required execute lands apply_patch without Continue thrash", async () => {
    const engine = new V8EnginePipeline(
      createStubDependencies({
        decision: createDecision({
          route: "execute",
          toolGrant: createReadOnlyGrant({
            maximumWorkspaceEffect: "write",
            allowedTools: ["apply_patch"],
            allowedEffects: ["workspace_write"],
            approvalMode: "never",
          }),
          reasonCodes: ["mutation_execute"],
        }),
        llm: new ScriptedLlmPort([
          {
            content: "",
            toolCalls: [
              {
                id: "call_1",
                name: "apply_patch",
                arguments: JSON.stringify({
                  patches: [
                    {
                      path: "src/auth/login.spec.ts",
                      oldText: "expect(false)",
                      newText: "expect(true)",
                    },
                  ],
                }),
              },
            ],
          },
          { content: "Fixed the assertion." },
        ]),
        toolResults: {
          apply_patch: {
            status: "succeeded",
            output: {
              checkpointId: "cp_g",
              changedFiles: ["src/auth/login.spec.ts"],
            },
          },
        },
      }),
    );

    const result = await engine.start({
      schemaVersion: 1,
      request: {
        sessionId: "sess_golden",
        mode: "agent",
        userMessage:
          "Fix the assertion in src/auth/login.spec.ts — apply_patch only that file.",
        workspace: { workspaceId: "ws_golden" },
      },
      workspaceRoot: "/workspace",
    }).result;

    expect(result.status).toBe("completed");
    expect(result.usage.toolCalls).toBeGreaterThan(0);
    expect(result.reasonCodes).not.toContain("stall_continue_suspended");
    expect(result.status).not.toBe("suspended");
  });

  it("resume Continue after stall resumes the same run", async () => {
    const checkpointStore = new InMemoryRunCheckpointStore();
    const textTurns = Array.from({ length: 4 }, (_, i) => ({
      content: `Still thinking ${i}.`,
    }));
    const engine = new V8EnginePipeline(
      createStubDependencies({
        checkpointStore,
        decision: createDecision({
          route: "execute",
          toolGrant: createReadOnlyGrant({
            maximumWorkspaceEffect: "write",
            allowedTools: ["apply_patch"],
            allowedEffects: ["workspace_write"],
            approvalMode: "never",
          }),
          reasonCodes: ["mutation_execute"],
        }),
        llm: new ScriptedLlmPort(textTurns),
      }),
    );

    const start = await engine.start({
      schemaVersion: 1,
      request: {
        sessionId: "sess_stall",
        mode: "agent",
        userMessage: "Continue fixing src/auth/session.ts",
        workspace: { workspaceId: "ws_stall" },
      },
      workspaceRoot: "/workspace",
      budget: { maxModelCalls: 20, maxToolCalls: 20, maxLoopIterations: 20 },
    }).result;

    expect(start.status).toBe("suspended");
    expect(start.suspension?.kind).toBe("continue_required");

    const resumeEngine = new V8EnginePipeline(
      createStubDependencies({
        checkpointStore,
        decision: createDecision({
          route: "execute",
          toolGrant: createReadOnlyGrant({
            maximumWorkspaceEffect: "write",
            allowedTools: ["apply_patch"],
            allowedEffects: ["workspace_write"],
            approvalMode: "never",
          }),
          reasonCodes: ["mutation_execute"],
        }),
        llm: new ScriptedLlmPort([
          {
            content: "",
            toolCalls: [
              {
                id: "p1",
                name: "apply_patch",
                arguments: JSON.stringify({
                  patches: [
                    {
                      path: "src/auth/session.ts",
                      oldText: "a",
                      newText: "b",
                    },
                  ],
                }),
              },
            ],
          },
          { content: "Done." },
        ]),
        toolResults: {
          apply_patch: {
            status: "succeeded",
            output: {
              checkpointId: "cp_s",
              changedFiles: ["src/auth/session.ts"],
            },
          },
        },
      }),
    );

    const resumed = await resumeEngine.resume({
      schemaVersion: 1,
      runId: start.runId,
      continueDecision: { decision: "continue" },
    }).result;

    expect(resumed.runId).toBe(start.runId);
    expect(resumed.reasonCodes).toContain("stall_continue_approved");
  });
});
