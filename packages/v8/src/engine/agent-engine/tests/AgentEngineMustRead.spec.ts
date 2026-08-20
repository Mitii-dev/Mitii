import { describe, expect, it } from "vitest";

import { AgentEnginePipeline } from "..";
import {
  createDecision,
  createReadOnlyGrant,
  createStubDependencies,
  ScriptedLlmPort,
} from "./fixtures/stubs";

function agentStartInput() {
  return {
    schemaVersion: 1 as const,
    request: {
      sessionId: "sess_1",
      mode: "agent" as const,
      userMessage: "Fix the session type error",
      workspace: { workspaceId: "ws_1" },
    },
    workspaceRoot: "/repo",
    taskList: {
      schemaVersion: 1 as const,
      source: "plan" as const,
      purpose: "execution" as const,
      items: [
        {
          id: "fix",
          title: "Change: Fix src/auth/session.ts",
          status: "active" as const,
          write: ["src/auth/session.ts"],
          mustRead: ["src/auth/types.ts"],
        },
      ],
    },
  };
}

function createWriteGrant() {
  return createReadOnlyGrant({
    maximumWorkspaceEffect: "write",
    allowedTools: ["update_todos", "apply_patch", "read_file"],
    allowedEffects: ["workspace_read", "workspace_write", "process_execute"],
  });
}

const PATCH_ARGS = JSON.stringify({
  patches: [
    {
      path: "src/auth/session.ts",
      oldText: "type Session = string",
      newText: "type Session = object",
    },
  ],
});

describe("AgentEngine must-read nudge", () => {
  it("withholds the first patch until mustRead files are loaded", async () => {
    const llm = new ScriptedLlmPort([
      {
        content: "",
        toolCalls: [
          {
            id: "patch_early",
            name: "apply_patch",
            arguments: PATCH_ARGS,
          },
        ],
      },
      {
        content: "",
        toolCalls: [
          {
            id: "read_types",
            name: "read_file",
            arguments: JSON.stringify({ path: "src/auth/types.ts" }),
          },
          {
            id: "patch_ok",
            name: "apply_patch",
            arguments: PATCH_ARGS,
          },
        ],
      },
      { content: "Fixed session after reading types." },
    ]);

    const engine = new AgentEnginePipeline(
      createStubDependencies({
        decision: createDecision({
          route: "execute",
          planningDepth: "none",
          repositoryContextRequired: false,
          toolGrant: createWriteGrant(),
          reasonCodes: ["mutation_execute"],
        }),
        llm,
      }),
    );

    const handle = engine.start(agentStartInput());
    const events: Array<{ type: string; toolName?: string; status?: string; reasonCode?: string }> =
      [];
    for await (const event of handle.events) {
      if (event.type === "tool_completed") {
        events.push(event);
      }
    }
    const result = await handle.result;

    expect(result.status).toBe("completed");
    expect(result.reasonCodes).toContain("must_read_nudged");
    expect(result.reasonCodes).not.toContain("unfulfilled_execute_exhausted");
    expect(events[0]).toMatchObject({
      toolName: "apply_patch",
      status: "rejected",
      reasonCode: "must_read_incomplete",
    });
    expect(events[1]).toMatchObject({
      toolName: "read_file",
      status: "succeeded",
    });
    expect(events[2]).toMatchObject({
      toolName: "apply_patch",
      status: "succeeded",
    });
  });

  it("lets a second patch through so the nudge cannot stall mutations", async () => {
    const llm = new ScriptedLlmPort([
      {
        content: "",
        toolCalls: [
          {
            id: "patch_1",
            name: "apply_patch",
            arguments: PATCH_ARGS,
          },
        ],
      },
      {
        content: "",
        toolCalls: [
          {
            id: "patch_2",
            name: "apply_patch",
            arguments: PATCH_ARGS,
          },
        ],
      },
      { content: "Patched without a second block." },
    ]);

    const engine = new AgentEnginePipeline(
      createStubDependencies({
        decision: createDecision({
          route: "execute",
          planningDepth: "none",
          repositoryContextRequired: false,
          toolGrant: createWriteGrant(),
          reasonCodes: ["mutation_execute"],
        }),
        llm,
      }),
    );

    const handle = engine.start(agentStartInput());
    const patchStatuses: string[] = [];
    for await (const event of handle.events) {
      if (event.type === "tool_completed" && event.toolName === "apply_patch") {
        patchStatuses.push(event.status);
      }
    }
    const result = await handle.result;

    expect(result.status).toBe("completed");
    expect(result.reasonCodes).toContain("must_read_nudged");
    expect(patchStatuses).toEqual(["rejected", "succeeded"]);
  });
});
