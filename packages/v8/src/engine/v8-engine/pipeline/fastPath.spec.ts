import { describe, expect, it } from "vitest";

import type { AgentEngineDependencies } from "../contracts";
import {
  createDecision,
  createReadOnlyGrant,
  createStubDependencies,
  ScriptedLlmPort,
} from "../tests/fixtures/stubs";
import { V8EnginePipeline } from "./V8EnginePipeline";

const startInput = {
  schemaVersion: 1 as const,
  workspaceRoot: "/repo",
  request: {
    sessionId: "sess_fast",
    mode: "agent" as const,
    userMessage: "Change the greeting in src/hello.ts to say hi.",
    workspace: { workspaceId: "ws_fast" },
    requestId: "req_fast_1",
  },
};

const patchCall = {
  id: "call_patch",
  name: "apply_patch",
  arguments: JSON.stringify({
    patches: [{ path: "src/hello.ts", oldText: "hello", newText: "hi" }],
  }),
};

function engineWith(params: {
  reasonCodes: Array<"mutation_execute" | "fast_path_explicit_paths">;
  planCalls: { count: number };
}) {
  const planning: NonNullable<AgentEngineDependencies["planning"]> = {
    plan: async () => {
      params.planCalls.count += 1;
      throw new Error("planning must not run on the fast path");
    },
  };
  const llm = new ScriptedLlmPort([
    { content: "Applying.", toolCalls: [patchCall] },
    { content: "Updated the greeting." },
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
        reasonCodes: params.reasonCodes,
      }),
      llm,
      planning,
      toolResults: {
        apply_patch: {
          status: "succeeded",
          output: {
            checkpointId: "cp_fast_1",
            changedFiles: ["src/hello.ts"],
          },
        },
      },
    }),
  );
  return { engine, llm };
}

describe("fast path for small explicit-path asks", () => {
  it("skips planning and discovery and goes straight to the mutate loop", async () => {
    const planCalls = { count: 0 };
    const { engine, llm } = engineWith({
      reasonCodes: ["mutation_execute", "fast_path_explicit_paths"],
      planCalls,
    });
    const result = await engine.start(startInput).result;

    expect(planCalls.count).toBe(0);
    expect(result.planningDepth).toBe("none");
    expect(result.reasonCodes).toContain("plan_skipped");
    expect(result.reasonCodes).toContain("fast_path_plan_skipped");
    expect(result.reasonCodes).not.toContain("discovery_started");
    expect(result.reasonCodes).toContain("mutation_applied");
    // First model request is the mutate loop itself (no discovery turn).
    expect(llm.requests[0]?.tools?.map((tool) => tool.name)).toContain(
      "apply_patch",
    );
  });

  it("does not claim the fast path without the decision reason code", async () => {
    const planCalls = { count: 0 };
    const { engine } = engineWith({
      reasonCodes: ["mutation_execute"],
      planCalls,
    });
    const result = await engine.start(startInput).result;

    expect(result.reasonCodes).toContain("plan_skipped");
    expect(result.reasonCodes).not.toContain("fast_path_plan_skipped");
  });
});
