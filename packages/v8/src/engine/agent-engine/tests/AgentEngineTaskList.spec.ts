import { describe, expect, it } from "vitest";

import { AgentEnginePipeline, runEventSchema } from "..";
import type { ModelRequest } from "../../../../modules/model-gateway";
import {
  createCapabilities,
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
      userMessage: "Implement the change in small steps",
      workspace: { workspaceId: "ws_1" },
    },
    workspaceRoot: "/repo",
  };
}

function createWriteGrant() {
  return createReadOnlyGrant({
    maximumWorkspaceEffect: "write",
    allowedTools: ["update_todos", "apply_patch", "read_file"],
    allowedEffects: ["workspace_read", "workspace_write", "process_execute"],
  });
}

describe("AgentEngine task list", () => {
  it("lets agent create and check tasks without stamping the rest done", async () => {
    const llm = new ScriptedLlmPort([
      {
        content: "",
        toolCalls: [
          {
            id: "todo_1",
            name: "update_todos",
            arguments: JSON.stringify({
              type: "replace",
              items: [
                { id: "one", title: "Read the module", status: "active" },
                { id: "two", title: "Write the fix" },
                { id: "three", title: "Add a test" },
              ],
            }),
          },
        ],
      },
      {
        content: "",
        toolCalls: [
          {
            id: "todo_2",
            name: "update_todos",
            arguments: JSON.stringify({
              type: "patch",
              items: [
                { id: "one", status: "done" },
                { id: "two", status: "active" },
              ],
            }),
          },
        ],
      },
      { content: "Finished the first slice." },
    ]);

    const engine = new AgentEnginePipeline(
      createStubDependencies({
        decision: createDecision({
          route: "execute",
          planningDepth: "none",
          repositoryContextRequired: false,
          toolGrant: createReadOnlyGrant(),
          reasonCodes: ["mutation_execute"],
        }),
        llm,
      }),
    );

    const handle = engine.start(agentStartInput());
    const [result, events] = await Promise.all([
      handle.result,
      (async () => {
        const collected = [];
        for await (const event of handle.events) {
          collected.push(event);
        }
        return collected;
      })(),
    ]);

    expect(result.status).toBe("completed");
    expect(result.taskList?.items.map((item) => item.status)).toEqual([
      "done",
      "active",
      "pending",
    ]);
    expect(result.reasonCodes).toContain("task_list_updated");
    const updates = events.filter((event) => event.type === "task_list_updated");
    expect(updates.length).toBeGreaterThanOrEqual(2);
    expect(updates.at(-1)).toMatchObject({
      completedCount: 1,
      totalCount: 3,
    });
    for (const event of events) {
      expect(() => runEventSchema.parse(event)).not.toThrow();
    }
  });

  it("does not create a task list in ask mode", async () => {
    const llm = new ScriptedLlmPort(
      [{ content: "Four." }],
      createCapabilities({ supportsTools: false }),
    );
    const engine = new AgentEnginePipeline(
      createStubDependencies({
        decision: createDecision({ route: "direct_answer" }),
        llm,
      }),
    );
    const result = await engine.start({
      schemaVersion: 1,
      request: {
        sessionId: "sess_1",
        mode: "ask",
        userMessage: "What is 2+2?",
        workspace: { workspaceId: "ws_1" },
      },
    }).result;
    expect(result.taskList).toBeUndefined();
    expect(result.reasonCodes).not.toContain("task_list_seeded");
  });

  it("does not seed a placeholder checklist for internal agent plans", async () => {
    const { PLANNING_SCHEMA_VERSION } = await import(
      "../../../modules/planning"
    );
    const internalPlan = {
      schemaVersion: PLANNING_SCHEMA_VERSION,
      objective: "Fix all the ts error in this packages",
      assumptions: [],
      openQuestions: [],
      contextReviewed: [],
      constraints: [],
      dimensions: {
        scope: "package" as const,
        risk: "low" as const,
        clarity: "clear" as const,
        complexity: "complex" as const,
        changeImpact: ["code" as const],
      },
      phases: [
        {
          id: "phase-discover",
          name: "Discover",
          purpose: "Inspect",
          steps: [
            {
              id: "step-1",
              intent: "Restate the goal and constraints from the spec",
              targetRefs: ["packages/mui-builder"],
              actionSummary: "Restate the goal",
              expectedOutcome: "Goal known",
              riskLevel: "low" as const,
            },
          ],
          dependencies: [],
          successCriteria: [],
        },
      ],
      risks: [],
      alternatives: [],
      verification: { checks: [], manualQa: [], commands: [] },
      approvalRequired: false,
      processHintsApplied: [],
    };
    const captured: ModelRequest[] = [];
    const llm = new ScriptedLlmPort(
      [{ content: "Working on the errors." }],
      createCapabilities({ supportsTools: true }),
    );
    const original = llm.complete.bind(llm);
    llm.complete = async function* (request: ModelRequest) {
      captured.push(request);
      yield* original(request);
    };
    const engine = new AgentEnginePipeline(
      createStubDependencies({
        decision: createDecision({
          route: "execute",
          planningDepth: "internal",
          repositoryContextRequired: false,
          toolGrant: createReadOnlyGrant(),
          reasonCodes: ["mutation_execute", "multi_file_internal_plan"],
        }),
        llm,
        planning: {
          plan: () => ({
            schemaVersion: PLANNING_SCHEMA_VERSION,
            status: "validated",
            plan: internalPlan,
            warnings: [],
            reasonCodes: ["plan_drafted"],
            usedTokens: 10,
            budgetTokens: 1_200,
            durationMs: 1,
          }),
        },
      }),
    );
    const result = await engine.start(agentStartInput()).result;
    expect(result.reasonCodes).toContain("plan_drafted");
    expect(result.reasonCodes).not.toContain("task_list_seeded");
    expect(result.taskList).toBeUndefined();
    const system = captured[0]?.messages.find(
      (message) => message.role === "system",
    );
    expect(system?.content).toContain("No live working list yet");
    expect(system?.content).toContain("update_todos");
    expect(system?.content).not.toMatch(/Diagnose the problem/i);
    expect(system?.content).not.toMatch(/\[ \] .*: Restate the goal/);
  });

  it("exposes update_todos to agent model requests", async () => {
    const captured: ModelRequest[] = [];
    const llm = new ScriptedLlmPort(
      [{ content: "Working." }],
      createCapabilities({ supportsTools: true }),
    );
    const original = llm.complete.bind(llm);
    llm.complete = async function* (request: ModelRequest) {
      captured.push(request);
      yield* original(request);
    };
    const engine = new AgentEnginePipeline(
      createStubDependencies({
        decision: createDecision({
          route: "execute",
          planningDepth: "none",
          repositoryContextRequired: false,
          toolGrant: createReadOnlyGrant(),
          reasonCodes: ["mutation_execute"],
        }),
        llm,
      }),
    );
    await engine.start(agentStartInput()).result;
    const names = captured[0]?.tools?.map((tool) => tool.name) ?? [];
    expect(names).toContain("update_todos");
  });

  it("auto-advances the active task after a successful mutating tool when opted in", async () => {
    const llm = new ScriptedLlmPort([
      {
        content: "",
        toolCalls: [
          {
            id: "todo_1",
            name: "update_todos",
            arguments: JSON.stringify({
              type: "replace",
              items: [
                { id: "change", title: "Update src/widget.ts", status: "active" },
                { id: "verify", title: "Verify src/widget.ts behavior" },
              ],
            }),
          },
          {
            id: "patch_1",
            name: "apply_patch",
            arguments: JSON.stringify({ patches: [] }),
          },
        ],
      },
      { content: "Changed the widget." },
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
        taskListAutoAdvance: true,
      }),
    );

    const result = await engine.start(agentStartInput()).result;
    expect(result.status).toBe("completed");
    // Verify rows stay pending — patches must not auto-activate process Verify.
    expect(result.taskList?.items.map((item) => item.status)).toEqual([
      "done",
      "pending",
    ]);
    expect(result.reasonCodes).toContain("task_list_auto_advanced");
  });

  it("auto-activates the next concrete change item after a successful mutation", async () => {
    const llm = new ScriptedLlmPort([
      {
        content: "",
        toolCalls: [
          {
            id: "todo_1",
            name: "update_todos",
            arguments: JSON.stringify({
              type: "replace",
              items: [
                { id: "a", title: "Update src/a.ts", status: "active" },
                { id: "b", title: "Update src/b.ts" },
              ],
            }),
          },
          {
            id: "patch_1",
            name: "apply_patch",
            arguments: JSON.stringify({ patches: [] }),
          },
        ],
      },
      { content: "Changed a." },
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
        taskListAutoAdvance: true,
      }),
    );

    const result = await engine.start(agentStartInput()).result;
    expect(result.taskList?.items.map((item) => item.status)).toEqual([
      "done",
      "active",
    ]);
    expect(result.reasonCodes).toContain("task_list_auto_advanced");
  });

  it("does not auto-advance package-wide mega-objectives without a file hint", async () => {
    const llm = new ScriptedLlmPort([
      {
        content: "",
        toolCalls: [
          {
            id: "todo_1",
            name: "update_todos",
            arguments: JSON.stringify({
              type: "replace",
              items: [
                {
                  id: "change",
                  title: "Change: Resolve all package errors",
                  detail: "Scope: packages/mui-builder",
                  status: "active",
                },
                { id: "verify", title: "Verify: Confirm package is green" },
              ],
            }),
          },
          {
            id: "patch_1",
            name: "apply_patch",
            arguments: JSON.stringify({ patches: [] }),
          },
        ],
      },
      { content: "Patched one file." },
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
        taskListAutoAdvance: true,
      }),
    );

    const result = await engine.start(agentStartInput()).result;
    expect(result.taskList?.items.map((item) => item.status)).toEqual([
      "active",
      "pending",
    ]);
    expect(result.reasonCodes).not.toContain("task_list_auto_advanced");
  });

  it("accepts todos/content aliases for update_todos replace", async () => {
    const llm = new ScriptedLlmPort([
      {
        content: "",
        toolCalls: [
          {
            id: "todo_1",
            name: "update_todos",
            arguments: JSON.stringify({
              type: "replace",
              todos: [
                {
                  id: "fix-a",
                  content: "Fix src/a.ts import error",
                  status: "in_progress",
                },
                {
                  id: "fix-b",
                  content: "Fix src/b.ts type error",
                  status: "todo",
                },
              ],
            }),
          },
        ],
      },
      { content: "Checklist replaced." },
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

    const result = await engine.start(agentStartInput()).result;
    expect(result.taskList?.items.map((item) => item.title)).toEqual([
      "Fix src/a.ts import error",
      "Fix src/b.ts type error",
    ]);
    expect(result.taskList?.items.map((item) => item.status)).toEqual([
      "active",
      "pending",
    ]);
  });

  it("leaves mutating-tool task status unchanged when auto-advance is not opted in", async () => {
    const llm = new ScriptedLlmPort([
      {
        content: "",
        toolCalls: [
          {
            id: "todo_1",
            name: "update_todos",
            arguments: JSON.stringify({
              type: "replace",
              items: [
                { id: "change", title: "Update src/widget.ts", status: "active" },
                { id: "verify", title: "Verify src/widget.ts behavior" },
              ],
            }),
          },
          {
            id: "patch_1",
            name: "apply_patch",
            arguments: JSON.stringify({ patches: [] }),
          },
        ],
      },
      { content: "Changed the widget." },
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

    const result = await engine.start(agentStartInput()).result;
    expect(result.taskList?.items.map((item) => item.status)).toEqual([
      "active",
      "pending",
    ]);
    expect(result.reasonCodes).not.toContain("task_list_auto_advanced");
  });

  it("does not auto-advance after successful read tools", async () => {
    const llm = new ScriptedLlmPort([
      {
        content: "",
        toolCalls: [
          {
            id: "todo_1",
            name: "update_todos",
            arguments: JSON.stringify({
              type: "replace",
              items: [
                { id: "read", title: "Read src/widget.ts", status: "active" },
                { id: "change", title: "Update src/widget.ts" },
              ],
            }),
          },
          {
            id: "read_1",
            name: "read_file",
            arguments: JSON.stringify({ path: "src/widget.ts" }),
          },
        ],
      },
      { content: "Read the widget." },
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
        taskListAutoAdvance: true,
      }),
    );

    const result = await engine.start(agentStartInput()).result;
    expect(result.taskList?.items.map((item) => item.status)).toEqual([
      "active",
      "pending",
    ]);
    expect(result.reasonCodes).not.toContain("task_list_auto_advanced");
  });

  it("auto-advances at most once per model turn even with multiple mutating tools", async () => {
    const llm = new ScriptedLlmPort([
      {
        content: "",
        toolCalls: [
          {
            id: "todo_1",
            name: "update_todos",
            arguments: JSON.stringify({
              type: "replace",
              items: [
                { id: "a", title: "Update src/a.ts", status: "active" },
                { id: "b", title: "Update src/b.ts" },
                { id: "c", title: "Update src/c.ts" },
              ],
            }),
          },
          {
            id: "patch_1",
            name: "apply_patch",
            arguments: JSON.stringify({ patches: [] }),
          },
          {
            id: "patch_2",
            name: "apply_patch",
            arguments: JSON.stringify({ patches: [] }),
          },
        ],
      },
      { content: "Patched twice." },
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
        taskListAutoAdvance: true,
      }),
    );

    const result = await engine.start(agentStartInput()).result;
    expect(result.taskList?.items.map((item) => item.status)).toEqual([
      "done",
      "active",
      "pending",
    ]);
    expect(
      result.reasonCodes.filter((code) => code === "task_list_auto_advanced"),
    ).toHaveLength(1);
  });

  it("accepts update_todo as an alias for update_todos", async () => {
    const llm = new ScriptedLlmPort([
      {
        content: "",
        toolCalls: [
          {
            id: "todo_alias",
            name: "update_todo",
            arguments: JSON.stringify({
              type: "replace",
              items: [{ id: "one", title: "Fix the package errors", status: "active" }],
            }),
          },
        ],
      },
      { content: "Checklist created." },
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

    const result = await engine.start(agentStartInput()).result;
    expect(result.status).toBe("completed");
    expect(result.taskList?.items).toHaveLength(1);
    expect(result.reasonCodes).toContain("task_list_updated");
  });

  it("accepts task_list_update as an alias for update_todos", async () => {
    const llm = new ScriptedLlmPort([
      {
        content: "",
        toolCalls: [
          {
            id: "todo_alias_2",
            name: "task_list_update",
            arguments: JSON.stringify({
              type: "replace",
              items: [
                {
                  id: "fix-a",
                  title: "Fix missing field prop in src/renderer.tsx",
                  status: "active",
                },
              ],
            }),
          },
        ],
      },
      { content: "Checklist replaced." },
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

    const result = await engine.start(agentStartInput()).result;
    expect(result.status).toBe("completed");
    expect(result.taskList?.items.map((item) => item.title)).toEqual([
      "Fix missing field prop in src/renderer.tsx",
    ]);
    expect(result.reasonCodes).toContain("task_list_updated");
  });

  it("blocks the first mutation until analyze_change_impact runs when recommended", async () => {
    const llm = new ScriptedLlmPort([
      {
        content: "",
        toolCalls: [
          {
            id: "patch_early",
            name: "apply_patch",
            arguments: JSON.stringify({ patches: [] }),
          },
        ],
      },
      {
        content: "",
        toolCalls: [
          {
            id: "impact_1",
            name: "analyze_change_impact",
            arguments: JSON.stringify({ path: "src/core.ts" }),
          },
        ],
      },
      {
        content: "",
        toolCalls: [
          {
            id: "patch_ok",
            name: "apply_patch",
            arguments: JSON.stringify({ patches: [] }),
          },
        ],
      },
      { content: "Patched after impact analysis." },
    ]);

    const engine = new AgentEnginePipeline(
      createStubDependencies({
        decision: createDecision({
          route: "execute",
          planningDepth: "visible",
          repositoryContextRequired: false,
          toolGrant: createReadOnlyGrant({
            maximumWorkspaceEffect: "write",
            allowedTools: [
              "analyze_change_impact",
              "apply_patch",
              "read_file",
              "update_todos",
            ],
            allowedEffects: [
              "workspace_read",
              "workspace_write",
              "process_execute",
            ],
          }),
          reasonCodes: [
            "mutation_execute",
            "broad_repair_visible_plan",
            "change_impact_recommended",
          ],
        }),
        llm,
      }),
    );

    const result = await engine.start(agentStartInput()).result;
    expect(result.status).toBe("completed");
    expect(result.reasonCodes).toContain("change_impact_gate_blocked");
    expect(result.reasonCodes).toContain("change_impact_observed");
  });
});
