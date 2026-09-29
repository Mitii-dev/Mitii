import { describe, expect, it } from "vitest";

import { AgentEngineError, agentRunResultSchema } from "../contracts";
import { composeV8Engine } from "../adapters";
import { V8EnginePipeline } from "./V8EnginePipeline";
import {
  createDecision,
  createStubDependencies,
  ScriptedLlmPort,
  createCapabilities,
  createReadOnlyGrant,
} from "../../agent-engine/tests/fixtures/stubs";

function askStartInput() {
  return {
    schemaVersion: 1 as const,
    request: {
      sessionId: "sess_v8",
      mode: "ask" as const,
      userMessage: "What is 2+2?",
      workspace: { workspaceId: "ws_v8" },
      requestId: "req_v8_1",
    },
  };
}

function executeStartInput() {
  return {
    schemaVersion: 1 as const,
    workspaceRoot: "/repo",
    request: {
      sessionId: "sess_v8",
      mode: "agent" as const,
      userMessage: "Fix src/auth/login.spec.ts — apply_patch only that file.",
      workspace: { workspaceId: "ws_v8" },
      requestId: "req_v8_exec",
    },
  };
}

describe("V8EnginePipeline Phase 2 thin loop", () => {
  it("completes a direct_answer ask route", async () => {
    const engine = new V8EnginePipeline(
      createStubDependencies({
        decision: createDecision({ route: "direct_answer" }),
        llm: new ScriptedLlmPort(
          [{ content: "Four." }],
          createCapabilities({ supportsTools: false }),
        ),
      }),
    );
    const handle = engine.start(askStartInput());
    const result = await handle.result;
    expect(agentRunResultSchema.parse(result).status).toBe("completed");
    expect(result.answer).toBe("Four.");
    expect(result.route).toBe("direct_answer");
    expect(result.reasonCodes).toContain("answer_produced");
  });

  it("completes a simple execute apply_patch turn", async () => {
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
            content: "Applying the fix.",
            toolCalls: [
              {
                id: "call_patch",
                name: "apply_patch",
                arguments: JSON.stringify({
                  patches: [
                    {
                      path: "src/auth/login.spec.ts",
                      oldText: "old",
                      newText: "new",
                    },
                  ],
                }),
              },
            ],
          },
          { content: "Patched login.spec.ts." },
        ]),
        toolResults: {
          apply_patch: {
            status: "succeeded",
            output: {
              checkpointId: "cp_v8_1",
              changedFiles: ["src/auth/login.spec.ts"],
            },
          },
        },
      }),
    );

    const result = await engine.start(executeStartInput()).result;
    expect(result.status).toBe("completed");
    expect(result.answer).toContain("Patched login.spec.ts");
    expect(result.reasonCodes).toContain("mutation_applied");
    expect(result.usage.toolCalls).toBeGreaterThan(0);
  });

  it("rejects invalid start input with AgentEngineError", () => {
    const engine = new V8EnginePipeline(createStubDependencies({}));
    expect(() =>
      engine.start({ schemaVersion: 1 } as never),
    ).toThrow(AgentEngineError);
  });

  it("restore fails without a checkpoint store / restore point", async () => {
    const engine = new V8EnginePipeline(createStubDependencies({}));
    await expect(
      engine.restore({
        schemaVersion: 1,
        runId: "run_v8_1",
        restorePointId: "rp_1",
        workspaceRoot: "/workspace",
      }),
    ).rejects.toBeInstanceOf(AgentEngineError);
  });

  it("composeV8Engine returns a V8EnginePipeline instance", () => {
    const llm = new ScriptedLlmPort(
      [{ content: "ok" }],
      createCapabilities({ supportsTools: false }),
    );
    const engine = composeV8Engine({
      understandingLlm: llm,
      runLlm: llm,
      enablePlanning: false,
      idGenerator: { next: (prefix: string) => `${prefix}_compose` },
    });
    expect(engine).toBeInstanceOf(V8EnginePipeline);
  });
});
