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

function readCall(id: string) {
  return {
    id,
    name: "read_file",
    arguments: JSON.stringify({ path: "src/form.ts" }),
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
});
