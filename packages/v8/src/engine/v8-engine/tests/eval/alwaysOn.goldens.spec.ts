/**
 * Always-on golden scenarios (§7.2) — stub LLM only, runs in unit CI.
 * Curated-40 product prompts live in curated-40.json (nightly/manual).
 */
import { describe, expect, it } from "vitest";

import {
  decideTruncationRecovery,
  discardIncompleteToolCalls,
  shouldForcePreflightRepairLock,
  truncationWarningMessage,
} from "../../actions";
import { V8EnginePipeline } from "../../pipeline/V8EnginePipeline";
import { InMemoryRunCheckpointStore } from "../../../agent-engine/adapters";
import {
  createDecision,
  createReadOnlyGrant,
  createStubDependencies,
  ScriptedLlmPort,
  createCapabilities,
} from "../../../agent-engine/tests/fixtures/stubs";
import { V8_ENGINE_PROMOTION } from "../../promotion";

describe("v8-engine always-on goldens (§7.2)", () => {
  it("promotion default is v8 with legacy rollback documented", () => {
    expect(V8_ENGINE_PROMOTION.defaultImplementation).toBe("v8");
    expect(V8_ENGINE_PROMOTION.status).toBe("promoted");
    expect(V8_ENGINE_PROMOTION.rollback.settingValue).toBe("legacy");
    expect(V8_ENGINE_PROMOTION.soakDaysRequired).toBeGreaterThanOrEqual(7);
  });

  it("G1: pasted multi-test dump beats unrelated preflight CSS", () => {
    expect(
      shouldForcePreflightRepairLock({
        route: "execute",
        maximumWorkspaceEffect: "write",
        preflightErrorCount: 11,
        userPrompt:
          "FAIL src/auth/login.spec.ts\nFAIL src/auth/session.spec.ts\nFix those specs.",
        diagnosticPaths: ["src/styles/legacy-theme.css"],
      }),
    ).toBe(false);
  });

  it("G2: reasoning abort is not labeled as max_tokens truncation", () => {
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
    expect(
      truncationWarningMessage({ reasoningBudgetExceeded: true }),
    ).not.toMatch(/max_tokens|maximumOutputTokens/i);
  });

  it("G3: unfulfilled execute recovers into apply_patch", async () => {
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
          { content: "Here is my diagnosis of the bug…" },
          {
            content: "",
            toolCalls: [
              {
                id: "p1",
                name: "apply_patch",
                arguments: JSON.stringify({
                  patches: [
                    { path: "src/a.ts", oldText: "x", newText: "y" },
                  ],
                }),
              },
            ],
          },
          { content: "Patched." },
        ]),
        toolResults: {
          apply_patch: {
            status: "succeeded",
            output: {
              checkpointId: "cp_g3",
              changedFiles: ["src/a.ts"],
            },
          },
        },
      }),
    );
    const result = await engine.start({
      schemaVersion: 1,
      workspaceRoot: "/repo",
      request: {
        sessionId: "g3",
        mode: "agent",
        userMessage: "Fix src/a.ts",
        workspace: { workspaceId: "ws" },
      },
    }).result;
    expect(result.status).toBe("completed");
    expect(result.reasonCodes).toContain("mutation_applied");
    expect(result.status).not.toBe("suspended");
  });

  it("G5: truncation counter resets when a complete tool call lands", () => {
    const afterTools = decideTruncationRecovery({
      finishReason: "length",
      hasToolCalls: true,
      incompleteToolCalls: false,
      truncationRecoveriesUsed: 2,
      maxTruncationRecoveries: 3,
    });
    expect(afterTools.resetCounter).toBe(true);
    expect(afterTools.shouldRecover).toBe(false);
  });

  it("G5b: incomplete truncated tool calls are discarded", () => {
    const { discardedCount, complete } = discardIncompleteToolCalls([
      {
        id: "ok",
        name: "read_file",
        arguments: JSON.stringify({ path: "a.ts" }),
      },
      { id: "bad", name: "apply_patch", arguments: '{"patches":[' },
    ]);
    expect(discardedCount).toBe(1);
    expect(complete).toHaveLength(1);
  });

  it("G7: Continue after stall does not restart intake", async () => {
    const store = new InMemoryRunCheckpointStore();
    const textTurns = Array.from({ length: 4 }, (_, i) => ({
      content: `Thinking ${i}`,
    }));
    const engine = new V8EnginePipeline(
      createStubDependencies({
        checkpointStore: store,
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
      workspaceRoot: "/repo",
      request: {
        sessionId: "g7",
        mode: "agent",
        userMessage: "Patch src/b.ts",
        workspace: { workspaceId: "ws" },
      },
      budget: { maxModelCalls: 20, maxToolCalls: 20, maxLoopIterations: 20 },
    }).result;
    expect(start.status).toBe("suspended");
    expect(start.suspension?.kind).toBe("continue_required");

    const resumed = await new V8EnginePipeline(
      createStubDependencies({
        checkpointStore: store,
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
                id: "p",
                name: "apply_patch",
                arguments: JSON.stringify({
                  patches: [
                    { path: "src/b.ts", oldText: "a", newText: "b" },
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
              checkpointId: "cp_g7",
              changedFiles: ["src/b.ts"],
            },
          },
        },
      }),
    ).resume({
      schemaVersion: 1,
      runId: start.runId,
      continueDecision: { decision: "continue" },
    }).result;

    expect(resumed.runId).toBe(start.runId);
    expect(resumed.reasonCodes).toContain("stall_continue_approved");
  });

  it("G8: ask/diagnose completes without mutation", async () => {
    const engine = new V8EnginePipeline(
      createStubDependencies({
        decision: createDecision({ route: "direct_answer" }),
        llm: new ScriptedLlmPort(
          [{ content: "The bug is a null check." }],
          createCapabilities({ supportsTools: false }),
        ),
      }),
    );
    const result = await engine.start({
      schemaVersion: 1,
      request: {
        sessionId: "g8",
        mode: "ask",
        userMessage: "Why does login fail?",
        workspace: { workspaceId: "ws" },
      },
    }).result;
    expect(result.status).toBe("completed");
    expect(result.usage.toolCalls).toBe(0);
    expect(result.answer).toContain("null check");
  });
});
