import { describe, expect, it } from "vitest";

import {
  createDecision,
  createReadOnlyGrant,
  createStubDependencies,
  ScriptedLlmPort,
} from "../tests/fixtures/stubs";
import { V8EnginePipeline } from "./V8EnginePipeline";

function startInput(userMessage: string) {
  return {
    schemaVersion: 1 as const,
    workspaceRoot: "/repo",
    request: {
      sessionId: "sess_create",
      mode: "agent" as const,
      userMessage,
      workspace: { workspaceId: "ws_create" },
      requestId: "req_create_1",
    },
  };
}

function engineWithModelReplies(
  replies: Array<{ content: string }>,
  reasonCodes: Array<"mutation_execute" | "agent_create_ask_execute">,
) {
  return new V8EnginePipeline(
    createStubDependencies({
      decision: createDecision({
        route: "execute",
        planningDepth: "none",
        toolGrant: createReadOnlyGrant({
          maximumWorkspaceEffect: "write",
          allowedTools: ["apply_patch", "read_file"],
          allowedEffects: ["workspace_read", "workspace_write"],
          approvalMode: "never",
        }),
        reasonCodes,
      }),
      llm: new ScriptedLlmPort(replies),
    }),
  );
}

describe("agent-mode explicit create ask never completes plan-only", () => {
  const planOnlyReplies = Array.from({ length: 8 }, (_, index) => ({
    content: `Here is the plan (${index}): create src/server.ts, then add the /health route.`,
  }));

  it("does not report completed when the model only describes a plan", async () => {
    const result = await engineWithModelReplies(planOnlyReplies, [
      "mutation_execute",
      "agent_create_ask_execute",
    ]).start(
      startInput("Create an Express server in src/server.ts with a /health route"),
    ).result;

    expect(result.status).not.toBe("completed");
    expect(["suspended", "failed"]).toContain(result.status);
    expect(result.reasonCodes).not.toContain("mutation_applied");
    expect(result.reasonCodes).not.toContain("answer_produced");
    if (result.status === "suspended") {
      expect(result.suspension?.kind).toBe("continue_required");
    } else {
      expect(result.reasonCodes).toContain("no_mutation_performed");
    }
  });

  it("completes normally once the mutation lands", async () => {
    const llm = new ScriptedLlmPort([
      {
        content: "Creating the server.",
        toolCalls: [
          {
            id: "call_create",
            name: "apply_patch",
            arguments: JSON.stringify({
              patches: [{ path: "src/server.ts", oldText: "", newText: "x" }],
            }),
          },
        ],
      },
      { content: "Created src/server.ts." },
    ]);
    const engine = new V8EnginePipeline(
      createStubDependencies({
        decision: createDecision({
          route: "execute",
          planningDepth: "none",
          toolGrant: createReadOnlyGrant({
            maximumWorkspaceEffect: "write",
            allowedTools: ["apply_patch", "read_file"],
            allowedEffects: ["workspace_read", "workspace_write"],
            approvalMode: "never",
          }),
          reasonCodes: ["mutation_execute", "agent_create_ask_execute"],
        }),
        llm,
        toolResults: {
          apply_patch: {
            status: "succeeded",
            output: { checkpointId: "cp_create_1", changedFiles: ["src/server.ts"] },
          },
        },
      }),
    );
    const result = await engine.start(
      startInput("Create an Express server in src/server.ts with a /health route"),
    ).result;

    expect(result.status).toBe("completed");
    expect(result.reasonCodes).toContain("mutation_applied");
  });
});
