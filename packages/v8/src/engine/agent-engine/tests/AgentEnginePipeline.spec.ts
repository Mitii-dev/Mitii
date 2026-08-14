import { describe, expect, it } from "vitest";

import {
  AgentEngineError,
  AgentEnginePipeline,
  agentEngineStartInputSchema,
  agentRunResultSchema,
  runEventSchema,
} from "..";
import { assembleToolCalls } from "../actions";
import type { ModelRequest } from "../../../../modules/model-gateway";
import type {
  RepositoryContextPipelineInput,
} from "../../../../modules/repository-context";
import {
  createDecision,
  createReadOnlyGrant,
  createStubDependencies,
  createUnderstanding,
  ScriptedLlmPort,
  createCapabilities,
} from "./fixtures/stubs";

function baseStartInput(
  overrides: Record<string, unknown> = {},
): ReturnType<typeof agentEngineStartInputSchema.parse> {
  return agentEngineStartInputSchema.parse({
    schemaVersion: 1,
    request: {
      sessionId: "sess_1",
      mode: "ask",
      userMessage: "What is 2+2?",
      workspace: { workspaceId: "ws_1" },
    },
    ...overrides,
  });
}

async function collectEvents(
  events: AsyncIterable<unknown>,
): Promise<unknown[]> {
  const collected: unknown[] = [];
  for await (const event of events) {
    collected.push(event);
  }
  return collected;
}

describe("AgentEnginePipeline (Phase 7)", () => {
  it("rejects invalid start input", () => {
    const engine = new AgentEnginePipeline(createStubDependencies({}));
    expect(() =>
      engine.start({ schemaVersion: 1 } as never),
    ).toThrow(AgentEngineError);
  });

  it("completes a direct_answer route end to end", async () => {
    const engine = new AgentEnginePipeline(
      createStubDependencies({
        decision: createDecision({ route: "direct_answer" }),
        llm: new ScriptedLlmPort(
          [{ content: "Four." }],
          createCapabilities({ supportsTools: false }),
        ),
      }),
    );

    const handle = engine.start(baseStartInput());
    const [result, events] = await Promise.all([
      handle.result,
      collectEvents(handle.events),
    ]);

    expect(agentRunResultSchema.parse(result).status).toBe("completed");
    expect(result.answer).toBe("Four.");
    expect(result.route).toBe("direct_answer");
    expect(result.reasonCodes).toContain("answer_produced");

    for (const event of events) {
      expect(() => runEventSchema.parse(event)).not.toThrow();
    }
    expect(events.some((e) => (e as { type: string }).type === "terminal")).toBe(
      true,
    );
  });

  it("continues truncated text-only answers instead of accepting a partial final answer", async () => {
    const engine = new AgentEnginePipeline(
      createStubDependencies({
        decision: createDecision({ route: "direct_answer" }),
        llm: new ScriptedLlmPort(
          [
            { content: "First half of the answer", finishReason: "length" },
            { content: "second half." },
          ],
          createCapabilities({ supportsTools: false }),
        ),
      }),
    );

    const result = await engine.start(baseStartInput()).result;

    expect(result.status).toBe("completed");
    expect(result.answer).toBe("First half of the answer\nsecond half.");
    expect(result.answer).not.toContain("output truncated");
    expect(result.reasonCodes).toContain("output_truncation_recovered");
  });

  it("recovers empty model turns instead of completing with stale narration", async () => {
    const engine = new AgentEnginePipeline(
      createStubDependencies({
        decision: createDecision({ route: "direct_answer" }),
        llm: new ScriptedLlmPort(
          [
            { content: "Let me check kitchen-flow.spec.ts more carefully:" },
            { content: "" },
            {
              content:
                "Yes — kitchen-flow.spec.ts imports were updated; old paths were removed.",
            },
          ],
          createCapabilities({ supportsTools: false }),
        ),
      }),
    );

    const result = await engine.start(baseStartInput()).result;

    expect(result.status).toBe("completed");
    expect(result.answer).toContain("kitchen-flow.spec.ts imports were updated");
    expect(result.reasonCodes).toContain("incomplete_answer_recovered");
  });

  it("falls back to a changed-files summary when incomplete recoveries are exhausted", async () => {
    const engine = new AgentEnginePipeline(
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
            content:
              "Now let me do the same for the Tablet BasePage - delete and recreate it extending the shared base:",
            toolCalls: [
              {
                id: "call_patch",
                name: "apply_patch",
                arguments: JSON.stringify({
                  patches: [
                    {
                      path: "test/Tablet/pages/BasePage.ts",
                      oldText: "old",
                      newText: "new",
                    },
                  ],
                }),
              },
            ],
          },
          { content: "" },
          { content: "" },
          {
            content:
              "All selector naming is now consistent. Let me run the verification steps from the plan - lint and typecheck:",
          },
        ]),
        toolResults: {
          apply_patch: {
            status: "succeeded",
            output: {
              checkpointId: "cp_1",
              changedFiles: ["test/Tablet/pages/BasePage.ts"],
            },
          },
        },
      }),
    );

    const result = await engine.start(
      baseStartInput({
        workspaceRoot: "/repo",
        request: {
          sessionId: "sess_1",
          mode: "agent",
          userMessage: "Refactor shared BasePage usage",
          workspace: { workspaceId: "ws_1" },
        },
      }),
    ).result;

    expect(result.status).toBe("completed");
    expect(result.answer).toContain("Completed workspace edits");
    expect(result.answer).toContain("test/Tablet/pages/BasePage.ts");
    expect(result.reasonCodes).toContain("incomplete_answer_recovered");
    expect(result.reasonCodes).toContain("incomplete_answer_fallback");
    expect(result.reasonCodes).toContain("mutation_applied");
  });

  it("suspends on clarification without calling the model", async () => {
    let modelCalls = 0;
    const llm = new ScriptedLlmPort([{ content: "should not run" }]);
    const original = llm.complete.bind(llm);
    llm.complete = async function* (...args) {
      modelCalls += 1;
      yield* original(...args);
    };

    const engine = new AgentEnginePipeline(
      createStubDependencies({
        decision: createDecision({
          route: "clarify",
          runDisposition: "clarification_required",
          rationale: "Which file should be diagnosed?",
        }),
        understanding: createUnderstanding({
          intent: {
            ...createUnderstanding().intent,
            recommendsClarification: true,
            classification: {
              ...createUnderstanding().intent.classification,
              needsClarification: true,
            },
          },
        }),
        llm,
      }),
    );

    const handle = engine.start(
      baseStartInput({
        request: {
          sessionId: "sess_1",
          mode: "ask",
          userMessage: "Fix it",
          workspace: { workspaceId: "ws_1" },
        },
      }),
    );
    const result = await handle.result;

    expect(result.status).toBe("suspended");
    expect(result.suspension?.kind).toBe("clarification_required");
    expect(result.suspension?.clarificationPrompt).toBeTruthy();
    expect(result.suspension?.clarificationPrompt).not.toContain(
      "<<<MITII_",
    );
    expect(result.suspension?.clarificationPrompt?.length ?? 0).toBeLessThan(
      2_000,
    );
    expect(modelCalls).toBe(0);
    expect(result.reasonCodes).toContain("clarification_suspended");
  });

  it("runs repository_answer with context and tools", async () => {
    const grant = createReadOnlyGrant();
    const engine = new AgentEnginePipeline(
      createStubDependencies({
        decision: createDecision({
          route: "repository_answer",
          repositoryContextRequired: true,
          pinnedState: { workspaceId: "ws_1", stateToken: "tok_1" },
          toolGrant: grant,
          reasonCodes: ["repository_grounded_answer"],
        }),
        contextBlocks: [
          {
            id: "b1",
            relativePath: "src/auth.ts",
            content: "export function login() {}",
          },
        ],
        llm: new ScriptedLlmPort([
          {
            toolCalls: [
              {
                id: "call_1",
                name: "read_file",
                arguments: JSON.stringify({ path: "src/auth.ts" }),
              },
            ],
          },
          { content: "login is exported from auth.ts" },
        ]),
      }),
    );

    const handle = engine.start(
      baseStartInput({
        workspaceRoot: "/repo",
        repositoryState: {
          reference: { workspaceId: "ws_1", stateToken: "tok_1" },
          readiness: "ready",
        },
        request: {
          sessionId: "sess_1",
          mode: "ask",
          userMessage: "What does auth export?",
          workspace: { workspaceId: "ws_1" },
        },
      }),
    );

    const [result, events] = await Promise.all([
      handle.result,
      collectEvents(handle.events),
    ]);
    expect(result.status).toBe("completed");
    expect(result.answer).toContain("login");
    expect(result.usage.toolCalls).toBe(1);
    expect(result.usage.modelCalls).toBe(2);
    expect(result.reasonCodes).toContain("context_retrieved");
    expect(result.reasonCodes).toContain("tools_executed");
    const toolStarted = events.find(
      (event): event is { type: "tool_started"; summary?: string } =>
        (event as { type?: string }).type === "tool_started",
    );
    expect(toolStarted?.summary).toBe("path=src/auth.ts");
    for (const event of events) {
      expect(() => runEventSchema.parse(event)).not.toThrow();
    }
  });

  it("scales repository selection budget from model context window", async () => {
    let capturedContextInput:
      | RepositoryContextPipelineInput
      | undefined;
    const dependencies = createStubDependencies({
      decision: createDecision({
        route: "repository_answer",
        repositoryContextRequired: true,
        pinnedState: { workspaceId: "ws_1", stateToken: "tok_1" },
      }),
      llm: new ScriptedLlmPort(
        [{ content: "done" }],
        createCapabilities({
          contextWindowTokens: 252_000,
          maximumOutputTokens: 64_000,
        }),
      ),
    });
    const originalExecute =
      dependencies.repositoryContext?.execute.bind(
        dependencies.repositoryContext,
      );
    dependencies.repositoryContext = {
      execute: async (input) => {
        capturedContextInput = input;
        return originalExecute!(input);
      },
    };

    const result = await new AgentEnginePipeline(dependencies)
      .start(
        baseStartInput({
          workspaceRoot: "/repo",
          repositoryState: {
            reference: { workspaceId: "ws_1", stateToken: "tok_1" },
            readiness: "ready",
          },
          request: {
            sessionId: "sess_1",
            mode: "ask",
            userMessage: "Use repo context",
            workspace: { workspaceId: "ws_1" },
          },
        }),
      )
      .result;

    expect(result.status).toBe("completed");
    expect(capturedContextInput?.selectionBudget?.maximumTokens).toBe(63_000);
    expect(capturedContextInput?.selectionBudget?.maximumItems).toBe(126);
    expect(capturedContextInput?.selectionBudget?.maximumFiles).toBe(84);
  });

  it("compacts completed tool call history before later model calls", async () => {
    const captured: ModelRequest[] = [];
    const hugeArguments = JSON.stringify({
      path: "src/large.ts",
      oldText: "a".repeat(12_000),
      newText: "b".repeat(12_000),
    });
    const llm = new ScriptedLlmPort(
      [
        {
          toolCalls: [
            { id: "call_1", name: "read_file", arguments: hugeArguments },
          ],
        },
        {
          toolCalls: [
            { id: "call_2", name: "read_file", arguments: hugeArguments },
          ],
        },
        { content: "done" },
      ],
      createCapabilities({
        contextWindowTokens: 4_096,
        maximumOutputTokens: 512,
        supportsTools: true,
      }),
    );
    const original = llm.complete.bind(llm);
    llm.complete = async function* (request, context) {
      captured.push(request);
      yield* original(request, context);
    };

    const engine = new AgentEnginePipeline(
      createStubDependencies({
        decision: createDecision({
          route: "repository_answer",
          repositoryContextRequired: true,
          pinnedState: { workspaceId: "ws_1", stateToken: "tok_1" },
          toolGrant: createReadOnlyGrant({ allowedTools: ["read_file"] }),
        }),
        llm,
      }),
    );

    const result = await engine.start(
      baseStartInput({
        workspaceRoot: "/repo",
        repositoryState: {
          reference: { workspaceId: "ws_1", stateToken: "tok_1" },
          readiness: "ready",
        },
        request: {
          sessionId: "sess_1",
          mode: "ask",
          userMessage: "Read the large file twice",
          workspace: { workspaceId: "ws_1" },
        },
      }),
    ).result;

    const secondRequestText = JSON.stringify(captured[1]?.messages ?? []);

    expect(result.status).toBe("completed");
    expect(captured).toHaveLength(3);
    expect(secondRequestText).not.toContain("a".repeat(1_000));
    expect(secondRequestText).toContain(
      "previous_completed_tool_call_arguments_omitted",
    );
    expect(result.warnings).toContain(
      "Compacted previous tool call history to keep follow-up model calls within the context budget.",
    );
  });

  it("runs diagnose read-only without mutation", async () => {
    const engine = new AgentEnginePipeline(
      createStubDependencies({
        decision: createDecision({
          route: "diagnose",
          repositoryContextRequired: true,
          pinnedState: { workspaceId: "ws_1", stateToken: "tok_1" },
          toolGrant: createReadOnlyGrant({
            allowedTools: ["read_diagnostics", "read_file"],
          }),
          reasonCodes: ["diagnosis_readonly"],
        }),
        llm: new ScriptedLlmPort([
          { content: "Root cause: null check missing in parse()." },
        ]),
      }),
    );

    const result = await engine.start(
      baseStartInput({
        workspaceRoot: "/repo",
        repositoryState: {
          reference: { workspaceId: "ws_1", stateToken: "tok_1" },
          readiness: "ready",
        },
        request: {
          sessionId: "sess_1",
          mode: "ask",
          userMessage: "Why does parse fail?",
          workspace: { workspaceId: "ws_1" },
        },
      }),
    ).result;

    expect(result.status).toBe("completed");
    expect(result.route).toBe("diagnose");
    expect(result.answer).toContain("Root cause");
  });

  it("suspends execute routes for approval when a mutation tool requires it (Phase 8)", async () => {
    const engine = new AgentEnginePipeline(
      createStubDependencies({
        decision: createDecision({
          route: "execute",
          toolGrant: createReadOnlyGrant({
            maximumWorkspaceEffect: "write",
            allowedTools: ["apply_patch"],
            allowedEffects: ["workspace_write"],
            approvalMode: "when_required",
          }),
          reasonCodes: ["mutation_execute"],
        }),
        llm: new ScriptedLlmPort([
          {
            toolCalls: [
              {
                id: "call_patch",
                name: "apply_patch",
                arguments: JSON.stringify({
                  patches: [
                    {
                      path: "src/a.ts",
                      oldText: "old",
                      newText: "new",
                    },
                  ],
                }),
              },
            ],
          },
        ]),
        toolResults: {
          apply_patch: {
            status: "rejected",
            reasonCode: "approval_required",
            output: {
              fingerprint: "fp_1",
              paths: ["src/a.ts"],
            },
          },
        },
      }),
    );

    const result = await engine.start(
      baseStartInput({ workspaceRoot: "/repo" }),
    ).result;

    expect(result.status).toBe("suspended");
    expect(result.suspension?.kind).toBe("approval_required");
    expect(result.suspension?.approval?.toolName).toBe("apply_patch");
    expect(result.suspension?.approval?.paths).toEqual(["src/a.ts"]);
    expect(result.reasonCodes).toContain("approval_suspended");
  });

  it("cancels an in-flight model turn", async () => {
    const llm: ScriptedLlmPort = new ScriptedLlmPort([
      { content: "slow" },
    ]);
    llm.complete = async function* (_request, context) {
      yield { type: "content_delta", content: "partial" };
      // Wait until aborted
      await new Promise<void>((resolve) => {
        if (context?.abortSignal?.aborted) {
          resolve();
          return;
        }
        context?.abortSignal?.addEventListener("abort", () => resolve(), {
          once: true,
        });
      });
      yield {
        type: "cancelled",
        error: {
          code: "cancelled",
          message: "Aborted",
          retryable: false,
        },
      };
    };

    const engine = new AgentEnginePipeline(
      createStubDependencies({
        decision: createDecision({ route: "direct_answer" }),
        llm,
      }),
    );

    const handle = engine.start(baseStartInput());
    queueMicrotask(() => handle.cancel("stop"));
    const result = await handle.result;

    expect(result.status).toBe("cancelled");
    expect(result.reasonCodes).toContain("cancelled");
  });

  it("terminates deterministically when model budget is exhausted", async () => {
    const engine = new AgentEnginePipeline(
      createStubDependencies({
        decision: createDecision({
          route: "repository_answer",
          repositoryContextRequired: false,
          toolGrant: createReadOnlyGrant(),
        }),
        llm: new ScriptedLlmPort([
          {
            toolCalls: [
              {
                id: "c1",
                name: "read_file",
                arguments: "{\"path\":\"a.ts\"}",
              },
            ],
          },
          {
            toolCalls: [
              {
                id: "c2",
                name: "read_file",
                arguments: "{\"path\":\"b.ts\"}",
              },
            ],
          },
          {
            toolCalls: [
              {
                id: "c3",
                name: "read_file",
                arguments: "{\"path\":\"c.ts\"}",
              },
            ],
          },
        ]),
      }),
    );

    const result = await engine.start(
      baseStartInput({
        workspaceRoot: "/repo",
        budget: {
          maxModelCalls: 2,
          maxToolCalls: 20,
          maxLoopIterations: 10,
          maxWallTimeMs: 60_000,
        },
      }),
    ).result;

    expect(result.status).toBe("budget_exhausted");
    expect(result.usage.modelCalls).toBeLessThanOrEqual(2);
  });

  it("reuses idempotent tool call ids within a run", async () => {
    let executions = 0;
    const deps = createStubDependencies({
      decision: createDecision({
        route: "repository_answer",
        repositoryContextRequired: false,
        toolGrant: createReadOnlyGrant(),
      }),
      llm: new ScriptedLlmPort([
        {
          toolCalls: [
            {
              id: "same",
              name: "read_file",
              arguments: "{\"path\":\"a.ts\"}",
            },
            {
              id: "same",
              name: "read_file",
              arguments: "{\"path\":\"a.ts\"}",
            },
          ],
        },
        { content: "done" },
      ]),
    });

    const originalExecute = deps.tools!.execute;
    deps.tools!.execute = async (input) => {
      executions += 1;
      return originalExecute(input);
    };

    const engine = new AgentEnginePipeline(deps);
    const result = await engine.start(
      baseStartInput({ workspaceRoot: "/repo" }),
    ).result;

    expect(result.status).toBe("completed");
    expect(executions).toBe(1);
  });

  it("assembles streamed tool call deltas", () => {
    const calls = assembleToolCalls([
      { index: 0, id: "t1", name: "read_file", arguments: "{\"pa" },
      { index: 0, arguments: "th\":\"x.ts\"}" },
    ]);
    expect(calls).toEqual([
      { id: "t1", name: "read_file", arguments: "{\"path\":\"x.ts\"}" },
    ]);
  });

  it("suspends for plan approval when planGate requires it", async () => {
    const { InMemoryRunCheckpointStore } = await import("../adapters");
    const { PLANNING_SCHEMA_VERSION } = await import(
      "../../../modules/planning"
    );

    const mockPlan = {
      schemaVersion: PLANNING_SCHEMA_VERSION,
      objective: "Migrate auth safely",
      assumptions: ["Existing login remains"],
      openQuestions: ["Which provider?"],
      contextReviewed: [],
      constraints: [],
      dimensions: {
        scope: "repository",
        risk: "high" as const,
        clarity: "partially_clear",
        complexity: "very_complex",
        changeImpact: ["code" as const, "security" as const],
      },
      phases: [
        {
          id: "phase-1",
          name: "Discover",
          purpose: "Find auth seams",
          steps: [
            {
              id: "step-1",
              intent: "Locate auth flow",
              targetRefs: ["src/auth"],
              actionSummary: "Search and read auth module",
              expectedOutcome: "Targets known",
              riskLevel: "medium" as const,
            },
          ],
          dependencies: [],
          successCriteria: ["Targets identified"],
        },
      ],
      risks: [
        {
          id: "risk-1",
          summary: "Session regression",
          severity: "high" as const,
        },
      ],
      alternatives: [],
      verification: {
        checks: ["tests"],
        manualQa: [],
        commands: [],
      },
      rollback: "Revert auth changes",
      approvalRequired: true,
      processHintsApplied: [],
    };

    let modelCalls = 0;
    const llm = new ScriptedLlmPort([{ content: "should not run yet" }]);
    const original = llm.complete.bind(llm);
    llm.complete = async function* (...args) {
      modelCalls += 1;
      yield* original(...args);
    };

    const checkpointStore = new InMemoryRunCheckpointStore();
    const engine = new AgentEnginePipeline(
      createStubDependencies({
        decision: createDecision({
          route: "execute",
          planningDepth: "visible",
          planGate: "required_before_execute",
          repositoryContextRequired: false,
          toolGrant: createReadOnlyGrant(),
          reasonCodes: ["mutation_execute", "plan_gate_required"],
        }),
        llm,
        planning: {
          plan: () => ({
            schemaVersion: PLANNING_SCHEMA_VERSION,
            status: "validated",
            plan: mockPlan,
            warnings: [],
            reasonCodes: ["plan_drafted", "plan_validated"],
            usedTokens: 40,
            budgetTokens: 1_200,
            durationMs: 1,
          }),
        },
        checkpointStore,
      }),
    );

    const handle = engine.start(
      baseStartInput({
        request: {
          sessionId: "sess_1",
          mode: "agent",
          userMessage: "Migrate auth across the repository",
          workspace: { workspaceId: "ws_1" },
        },
        workspaceRoot: "/repo",
      }),
    );
    const result = await handle.result;

    expect(result.status).toBe("suspended");
    expect(result.suspension?.kind).toBe("plan_approval_required");
    expect(result.plan?.objective).toBe("Migrate auth safely");
    expect(modelCalls).toBe(0);
    expect(result.reasonCodes).toContain("plan_approval_suspended");

    const resumedLlm = new ScriptedLlmPort([{ content: "Executed after plan." }]);
    const resumeEngine = new AgentEnginePipeline(
      createStubDependencies({
        decision: createDecision({
          route: "execute",
          planningDepth: "visible",
          planGate: "required_before_execute",
          repositoryContextRequired: false,
          toolGrant: createReadOnlyGrant(),
          reasonCodes: ["mutation_execute", "plan_gate_required"],
        }),
        llm: resumedLlm,
        planning: {
          plan: () => ({
            schemaVersion: PLANNING_SCHEMA_VERSION,
            status: "validated",
            plan: mockPlan,
            warnings: [],
            reasonCodes: ["plan_drafted"],
            usedTokens: 40,
            budgetTokens: 1_200,
            durationMs: 1,
          }),
        },
        checkpointStore,
      }),
    );

    const resumed = await resumeEngine.resume({
      schemaVersion: 1,
      runId: result.runId,
      planDecision: { decision: "approved" },
    }).result;

    expect(resumed.status).toBe("completed");
    expect(resumed.reasonCodes).toContain("plan_approved");
    expect(resumed.answer).toBe("Executed after plan.");
  });

  it("completes plan mode with the structured plan as the answer", async () => {
    const { PLANNING_SCHEMA_VERSION, formatPlanAsAnswer } = await import(
      "../../../modules/planning"
    );

    const mockPlan = {
      schemaVersion: PLANNING_SCHEMA_VERSION,
      objective: "Add SSO without breaking password login",
      assumptions: ["Password login remains"],
      openQuestions: ["Which OIDC provider?"],
      contextReviewed: [],
      constraints: ["Keep password login working"],
      dimensions: {
        scope: "package",
        risk: "high" as const,
        clarity: "partially_clear",
        complexity: "complex",
        changeImpact: ["code" as const, "security" as const],
      },
      phases: [
        {
          id: "phase-1",
          name: "Discover",
          purpose: "Map auth seams",
          steps: [
            {
              id: "step-1",
              intent: "Locate auth flow",
              targetRefs: ["src/auth"],
              actionSummary: "Search and read auth module",
              expectedOutcome: "Targets known",
              riskLevel: "medium" as const,
            },
          ],
          dependencies: [],
          successCriteria: ["Targets identified"],
        },
      ],
      risks: [
        {
          id: "risk-1",
          summary: "Session regression",
          severity: "high" as const,
        },
      ],
      alternatives: [],
      verification: {
        checks: ["tests"],
        manualQa: [],
        commands: [],
      },
      rollback: "Revert auth changes",
      approvalRequired: true,
      processHintsApplied: [],
    };

    let modelCalls = 0;
    const llm = new ScriptedLlmPort([{ content: "should not run in plan mode" }]);
    const original = llm.complete.bind(llm);
    llm.complete = async function* (...args) {
      modelCalls += 1;
      yield* original(...args);
    };

    const engine = new AgentEnginePipeline(
      createStubDependencies({
        decision: createDecision({
          route: "plan",
          planningDepth: "visible",
          planGate: "none",
          repositoryContextRequired: false,
          toolGrant: createReadOnlyGrant(),
          reasonCodes: ["mode_plan_only", "explicit_plan_request"],
        }),
        llm,
        planning: {
          plan: () => ({
            schemaVersion: PLANNING_SCHEMA_VERSION,
            status: "validated",
            plan: mockPlan,
            warnings: [],
            reasonCodes: ["plan_drafted", "plan_validated"],
            usedTokens: 40,
            budgetTokens: 1_200,
            durationMs: 1,
          }),
        },
      }),
    );

    const result = await engine.start(
      baseStartInput({
        request: {
          sessionId: "sess_1",
          mode: "plan",
          userMessage: "Plan SSO login without breaking password login",
          workspace: { workspaceId: "ws_1" },
        },
        workspaceRoot: "/repo",
      }),
    ).result;

    expect(result.status).toBe("completed");
    expect(result.plan?.objective).toBe("Add SSO without breaking password login");
    expect(result.answer).toBe(formatPlanAsAnswer(mockPlan));
    expect(result.reasonCodes).toContain("plan_drafted");
    expect(result.reasonCodes).toContain("plan_mode_completed");
    expect(result.reasonCodes).toContain("answer_produced");
    expect(result.reasonCodes).toContain("task_list_seeded");
    expect(result.taskList?.items.length).toBeGreaterThan(0);
    expect(result.taskList?.items[0]?.status).toBe("active");
    expect(
      result.taskList?.items.slice(1).every((item) => item.status === "pending"),
    ).toBe(true);
    expect(modelCalls).toBe(0);
  });

  it("carries host conversation into the model request", async () => {
    const captured: ModelRequest[] = [];
    const llm = new ScriptedLlmPort(
      [{ content: "Follow-up answer." }],
      createCapabilities({ supportsTools: false }),
    );
    const original = llm.complete.bind(llm);
    llm.complete = async function* (request: ModelRequest) {
      captured.push(request);
      yield* original(request);
    };

    const engine = new AgentEnginePipeline(
      createStubDependencies({
        decision: createDecision({ route: "direct_answer" }),
        llm,
      }),
    );

    const handle = engine.start(
      baseStartInput({
        conversation: [
          { role: "user", content: "Earlier: what is the stack?" },
          { role: "assistant", content: "TypeScript monorepo." },
        ],
        request: {
          sessionId: "sess_1",
          mode: "ask",
          userMessage: "Summarize that answer.",
          workspace: { workspaceId: "ws_1" },
        },
      }),
    );
    const result = await handle.result;

    expect(result.status).toBe("completed");
    expect(captured).toHaveLength(1);
    const contents = captured[0]!.messages.map((m) => m.content).join("\n");
    expect(contents).toContain("Earlier: what is the stack?");
    expect(contents).toContain("TypeScript monorepo.");
    expect(contents).toContain("Summarize that answer.");
  });

  it("applies host-carried approvedPlan without plan-gate suspension", async () => {
    let planningCalls = 0;
    const llm = new ScriptedLlmPort(
      [{ content: "Executing carried plan." }],
      createCapabilities({ supportsTools: false }),
    );
    const { PLANNING_SCHEMA_VERSION } = await import(
      "../../../modules/planning"
    );
    const carriedPlan = {
      schemaVersion: PLANNING_SCHEMA_VERSION,
      objective: "Ship conversation carry",
      assumptions: [],
      openQuestions: [],
      contextReviewed: [],
      constraints: [],
      dimensions: {
        scope: "module",
        risk: "medium" as const,
        clarity: "clear",
        complexity: "moderate",
        changeImpact: ["code" as const],
      },
      phases: [
        {
          id: "phase-1",
          name: "Wire",
          purpose: "Connect host to engine",
          steps: [
            {
              id: "step-1",
              intent: "Pass conversation + plan",
              targetRefs: ["apps/vscode"],
              actionSummary: "Map thread history and pending plan into start",
              expectedOutcome: "Carry works",
              riskLevel: "low" as const,
            },
          ],
          dependencies: [],
          successCriteria: ["Tests pass"],
        },
      ],
      risks: [],
      alternatives: [],
      verification: { checks: ["unit"], manualQa: [], commands: [] },
      approvalRequired: true,
      processHintsApplied: [],
    };

    const engine = new AgentEnginePipeline(
      createStubDependencies({
        decision: createDecision({
          route: "execute",
          planningDepth: "visible",
          planGate: "required_before_execute",
          repositoryContextRequired: false,
          toolGrant: createReadOnlyGrant(),
          reasonCodes: ["mutation_execute", "plan_gate_required"],
        }),
        llm,
        planning: {
          plan: () => {
            planningCalls += 1;
            return {
              schemaVersion: PLANNING_SCHEMA_VERSION,
              status: "validated",
              plan: carriedPlan,
              warnings: [],
              reasonCodes: ["plan_drafted"],
              usedTokens: 10,
              budgetTokens: 1_200,
              durationMs: 1,
            };
          },
        },
      }),
    );

    const captured: ModelRequest[] = [];
    const original = llm.complete.bind(llm);
    llm.complete = async function* (request: ModelRequest) {
      captured.push(request);
      yield* original(request);
    };

    const result = await engine.start(
      baseStartInput({
        approvedPlan: carriedPlan,
        request: {
          sessionId: "sess_1",
          mode: "agent",
          userMessage: "Execute the plan",
          workspace: { workspaceId: "ws_1" },
        },
        workspaceRoot: "/repo",
      }),
    ).result;

    expect(result.status).toBe("completed");
    expect(result.reasonCodes).toContain("plan_carried");
    expect(result.reasonCodes).not.toContain("plan_approval_suspended");
    expect(planningCalls).toBe(0);
    expect(result.plan?.objective).toBe("Ship conversation carry");
    expect(result.taskList?.items[0]?.status).toBe("active");
    expect(result.reasonCodes).toContain("task_list_seeded");
    const system = captured[0]?.messages.find((m) => m.role === "system");
    expect(system?.content).toContain("<approved_plan");
    expect(system?.content).toContain("Ship conversation carry");
    expect(system?.content).toContain("<task_list");
  });
});
