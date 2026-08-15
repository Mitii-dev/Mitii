import { describe, expect, it } from "vitest";

import { AgentEnginePipeline } from "..";
import {
  PLANNING_SCHEMA_VERSION,
  type PlanArtifact,
  type PlanningInput,
} from "../../../modules/planning";
import type { RepoBuildState } from "../../../modules/verification";
import {
  createCapabilities,
  createDecision,
  createReadOnlyGrant,
  createStubDependencies,
  createUnderstanding,
  ScriptedLlmPort,
} from "./fixtures/stubs";
import {
  createDiscoveryObservationCollector,
  recordDiscoveryToolUse,
} from "../internal/discoveryPass";

function planStartInput(userMessage: string) {
  return {
    schemaVersion: 1 as const,
    request: {
      sessionId: "sess_1",
      mode: "plan" as const,
      userMessage,
      workspace: { workspaceId: "ws_1" },
    },
    workspaceRoot: "/repo",
  };
}

function executionPlan(objective: string, file: string): PlanArtifact {
  return {
    schemaVersion: PLANNING_SCHEMA_VERSION,
    objective,
    assumptions: [],
    openQuestions: [],
    contextReviewed: [{ kind: "file", ref: file }],
    constraints: [],
    dimensions: {
      scope: "module",
      risk: "low",
      clarity: "clear",
      complexity: "simple",
      changeImpact: ["code"],
    },
    phases: [
      {
        id: "phase-change",
        name: "Change",
        purpose: "Apply the change",
        steps: [
          {
            id: "step-1",
            intent: `Change: Fix ${file}:88`,
            targetRefs: [file],
            actionSummary: `Edit ${file}`,
            expectedOutcome: "Requested behavior is implemented.",
            riskLevel: "low",
          },
        ],
        dependencies: [],
        successCriteria: ["File change is applied"],
      },
      {
        id: "phase-verify",
        name: "Verify",
        purpose: "Prove the change",
        steps: [
          {
            id: "step-2",
            intent: `Verify: Update ${file.replace(/\.ts$/, ".test.ts")}`,
            targetRefs: [file.replace(/\.ts$/, ".test.ts")],
            actionSummary: "Update the nearby test",
            expectedOutcome: "Focused test covers the change.",
            riskLevel: "low",
          },
        ],
        dependencies: ["phase-change"],
        successCriteria: ["Test is updated"],
      },
    ],
    risks: [],
    alternatives: [],
    verification: { checks: ["tests"], manualQa: [], commands: [] },
    approvalRequired: false,
    processHintsApplied: [],
  };
}

function repoBuildState(
  diagnostics: RepoBuildState["diagnostics"],
): RepoBuildState {
  return {
    schemaVersion: 1,
    capturedAt: "2026-07-25T12:00:00.000Z",
    phase: "before",
    scope: {
      workspaceRoot: "/repo",
      folderPrefixes: [],
      projectIds: [],
      changeScope: "localized",
    },
    checks: [],
    diagnostics,
    summary: {
      errorCount: diagnostics.filter((d) => d.severity === "error").length,
      warningCount: 0,
      failedCheckIds: [],
    },
    reasonCodes: [],
  };
}

describe("AgentEngine discovery (discover_and_plan)", () => {
  it("records discovered paths from read-only tool output", () => {
    const collector = createDiscoveryObservationCollector();

    recordDiscoveryToolUse({
      collector,
      toolName: "search_files",
      argumentsValue: { query: "createCharge" },
      resultOutput: {
        matches: [
          {
            path: "src/payments/client.ts",
            line: "createCharge(request)",
          },
        ],
      },
      status: "succeeded",
    });

    expect(collector.searchHits.map((hit) => hit.path)).toContain(
      "src/payments/client.ts",
    );
  });

  it("skips discovery for a small one-file plan_from_ask task (engine rules resolve strategy — no strategy LLM)", async () => {
    let planningCalls = 0;
    let captured: PlanningInput | undefined;
    const llm = new ScriptedLlmPort(
      [{ content: "should not run discovery" }],
      createCapabilities({ supportsTools: true }),
    );
    let modelCalls = 0;
    const original = llm.complete.bind(llm);
    llm.complete = async function* (...args) {
      modelCalls += 1;
      yield* original(...args);
    };

    const plan = executionPlan(
      "Show a loading label on Sign in",
      "src/LoginForm.tsx",
    );
    const engine = new AgentEnginePipeline(
      createStubDependencies({
        decision: createDecision({
          route: "plan",
          planningDepth: "visible",
          planGate: "none",
          repositoryContextRequired: false,
          toolGrant: createReadOnlyGrant(),
          reasonCodes: ["mode_plan_only"],
        }),
        understanding: createUnderstanding({
          taskAnalysis: {
            ...createUnderstanding().taskAnalysis,
            scope: "single_location",
            complexity: "simple",
            targets: [
              { kind: "file", value: "src/LoginForm.tsx", explicit: true },
            ],
          },
        }),
        llm,
        planning: {
          plan: async (input) => {
            planningCalls += 1;
            captured = input;
            return {
              schemaVersion: PLANNING_SCHEMA_VERSION,
              status: "validated",
              plan,
              warnings: [],
              reasonCodes: ["plan_drafted"],
              usedTokens: 10,
              budgetTokens: 1_200,
              durationMs: 1,
              strategy: {
                schemaVersion: 1,
                strategy: "plan_from_ask",
                rationale: "plan_from_ask selected for the test.",
                skipDiscover: true,
                useBuildEvidence: false,
              },
            };
          },
        },
      }),
    );

    const handle = engine.start(
      planStartInput(
        "In src/LoginForm.tsx, show a loading label on Sign in.",
      ),
    );
    const events: Array<{ type: string }> = [];
    for await (const event of handle.events) {
      events.push(event);
    }
    const result = await handle.result;

    expect(result.status).toBe("completed");
    expect(planningCalls).toBe(1);
    expect(modelCalls).toBe(0);
    expect(captured?.discoveryBrief).toBeUndefined();
    expect(captured?.strategyOverride?.strategy).toBe("plan_from_ask");
    expect(events.some((event) => event.type === "discovery_started")).toBe(
      false,
    );
    expect(result.taskList?.purpose).toBe("execution");
    expect(result.taskList?.source).toBe("plan");
    expect(result.reasonCodes).not.toContain("discovery_started");
  });

  it("skips discovery for a real in-scope repair (engine rules resolve follow_evidence from actual preflight diagnostics)", async () => {
    let captured: PlanningInput | undefined;
    const plan = executionPlan(
      "Fix session type error",
      "src/auth/session.ts",
    );
    const engine = new AgentEnginePipeline(
      createStubDependencies({
        decision: createDecision({
          route: "plan",
          planningDepth: "visible",
          planGate: "none",
          repositoryContextRequired: false,
          toolGrant: createReadOnlyGrant(),
          reasonCodes: ["mode_plan_only", "preflight_build_recommended"],
          pinnedState: { workspaceId: "ws_1", stateToken: "state_1" },
        }),
        understanding: createUnderstanding({
          intent: {
            ...createUnderstanding().intent,
            classification: {
              ...createUnderstanding().intent.classification,
              primaryTaskIntent: "bugfix",
            },
          },
          taskAnalysis: {
            ...createUnderstanding().taskAnalysis,
            scope: "module",
            complexity: "moderate",
            targets: [
              { kind: "file", value: "src/auth/session.ts", explicit: true },
            ],
          },
        }),
        verification: {
          verify: async () => {
            throw new Error("verify() should not run for Plan mode.");
          },
          captureBuildState: async () =>
            repoBuildState([
              {
                path: "src/auth/session.ts",
                severity: "error",
                message: "Type 'string' is not assignable to type 'Session'.",
                startLine: 12,
                source: "tsc",
                code: "TS2322",
              },
            ]),
        },
        planning: {
          plan: async (input) => {
            captured = input;
            return {
              schemaVersion: PLANNING_SCHEMA_VERSION,
              status: "validated",
              plan,
              warnings: [],
              reasonCodes: ["plan_drafted"],
              usedTokens: 10,
              budgetTokens: 1_200,
              durationMs: 1,
              strategy: {
                schemaVersion: 1,
                strategy: "follow_evidence",
                rationale: "follow_evidence selected for the test.",
                skipDiscover: true,
                useBuildEvidence: true,
              },
            };
          },
        },
      }),
    );

    const handle = engine.start({
      ...planStartInput("Fix the type error in src/auth/session.ts"),
      repositoryState: {
        reference: { workspaceId: "ws_1", stateToken: "state_1" },
        readiness: "ready",
      },
    });
    const events: Array<{ type: string }> = [];
    for await (const event of handle.events) {
      events.push(event);
    }
    const result = await handle.result;

    expect(result.status).toBe("completed");
    expect(events.some((event) => event.type === "discovery_started")).toBe(
      false,
    );
    expect(captured?.strategyOverride?.strategy).toBe("follow_evidence");
    expect(captured?.discoveryBrief).toBeUndefined();
    expect(captured?.buildEvidence?.diagnostics?.[0]?.path).toBe(
      "src/auth/session.ts",
    );
    expect(result.taskList?.items[0]?.title).toMatch(/session\.ts/);
    expect(result.taskList?.purpose).toBe("execution");
  });

  it("skips discovery for a broad package TS repair even when preflight captured no diagnostics", async () => {
    let captured: PlanningInput | undefined;
    const plan = executionPlan(
      "Resolve all TypeScript compilation/type errors in the target package",
      "packages/mui-builder",
    );
    const engine = new AgentEnginePipeline(
      createStubDependencies({
        decision: createDecision({
          route: "plan",
          planningDepth: "visible",
          planGate: "none",
          repositoryContextRequired: false,
          toolGrant: createReadOnlyGrant(),
          reasonCodes: ["mode_plan_only", "preflight_build_recommended"],
          pinnedState: { workspaceId: "ws_1", stateToken: "state_1" },
        }),
        understanding: createUnderstanding({
          intent: {
            ...createUnderstanding().intent,
            classification: {
              ...createUnderstanding().intent.classification,
              primaryTaskIntent: "bugfix",
              interactionIntent: "act",
            },
          },
          taskAnalysis: {
            ...createUnderstanding().taskAnalysis,
            scope: "package",
            complexity: "moderate",
            recommendsPlanning: true,
            recommendsVerification: true,
            targets: [
              {
                kind: "folder",
                value: "packages/mui-builder",
                explicit: true,
              },
            ],
            requestedOutcomes: [
              "Resolve all TypeScript compilation/type errors in the target package",
            ],
          },
        }),
        verification: {
          verify: async () => {
            throw new Error("verify() should not run for Plan mode.");
          },
          captureBuildState: async () => repoBuildState([]),
        },
        planning: {
          plan: async (input) => {
            captured = input;
            return {
              schemaVersion: PLANNING_SCHEMA_VERSION,
              status: "validated",
              plan,
              warnings: [],
              reasonCodes: ["plan_drafted"],
              usedTokens: 10,
              budgetTokens: 1_200,
              durationMs: 1,
              strategy: {
                schemaVersion: 1,
                strategy: "follow_evidence",
                rationale: "follow_evidence selected for the test.",
                skipDiscover: true,
                useBuildEvidence: false,
              },
            };
          },
        },
      }),
    );

    const handle = engine.start({
      ...planStartInput(
        "@packages/mui-builder\nPlease fix all the ts erros in this package",
      ),
      repositoryState: {
        reference: { workspaceId: "ws_1", stateToken: "state_1" },
        readiness: "ready",
      },
    });
    const events: Array<{ type: string }> = [];
    for await (const event of handle.events) {
      events.push(event);
    }
    const result = await handle.result;

    expect(result.status).toBe("completed");
    expect(events.some((event) => event.type === "discovery_started")).toBe(
      false,
    );
    expect(captured?.strategyOverride?.strategy).toBe("follow_evidence");
    expect(captured?.discoveryBrief).toBeUndefined();
    expect(result.reasonCodes).not.toContain("discovery_started");
  });

  it("runs discovery then one plan call for a complex multi-file discover_and_plan task", async () => {
    const captured: PlanningInput[] = [];
    const taskLists: Array<{ source: string; purpose?: string; title?: string }> =
      [];
    const plan = executionPlan(
      "Add retry around the payment client",
      "src/payments/client.ts",
    );
    const llm = new ScriptedLlmPort(
      [
        {
          content: "",
          toolCalls: [
            {
              id: "read_1",
              name: "read_file",
              arguments: JSON.stringify({ path: "src/payments/client.ts" }),
            },
          ],
        },
        { content: "Found the payment client entrypoint." },
      ],
      createCapabilities({ supportsTools: true }),
    );

    const engine = new AgentEnginePipeline(
      createStubDependencies({
        decision: createDecision({
          route: "plan",
          planningDepth: "visible",
          planGate: "none",
          repositoryContextRequired: false,
          toolGrant: createReadOnlyGrant(),
          reasonCodes: ["mode_plan_only"],
        }),
        understanding: createUnderstanding({
          taskAnalysis: {
            ...createUnderstanding().taskAnalysis,
            scope: "multi_file",
            complexity: "complex",
            recommendsPlanning: true,
            targets: [
              { kind: "folder", value: "src/payments", explicit: true },
            ],
          },
        }),
        llm,
        planning: {
          plan: async (input) => {
            captured.push(input);
            return {
              schemaVersion: PLANNING_SCHEMA_VERSION,
              status: "validated",
              plan,
              warnings: [],
              reasonCodes: ["plan_drafted", "plan_discovery_applied"],
              usedTokens: 20,
              budgetTokens: 1_200,
              durationMs: 1,
              strategy: {
                schemaVersion: 1,
                strategy: "discover_and_plan",
                rationale: "discover_and_plan selected for the test.",
                skipDiscover: true,
                useBuildEvidence: false,
              },
            };
          },
        },
      }),
    );

    const handle = engine.start(
      planStartInput(
        "Add retries around the payment client without changing the public API.",
      ),
    );
    const events: Array<Record<string, unknown>> = [];
    for await (const event of handle.events) {
      events.push(event as Record<string, unknown>);
      if (event.type === "task_list_updated") {
        taskLists.push({
          source: event.source,
          purpose: event.taskList.purpose,
          title: event.taskList.title,
        });
      }
    }
    const result = await handle.result;

    expect(result.status).toBe("completed");
    expect(events.some((event) => event.type === "discovery_started")).toBe(
      true,
    );
    expect(events.some((event) => event.type === "discovery_progress")).toBe(
      true,
    );
    expect(events.some((event) => event.type === "discovery_completed")).toBe(
      true,
    );
    expect(result.reasonCodes).toContain("discovery_started");
    expect(result.reasonCodes).toContain("discovery_completed");
    expect(captured).toHaveLength(1);
    expect(captured[0]?.discoveryBrief?.filesRead.map((file) => file.path)).toEqual(
      expect.arrayContaining(["src/payments/client.ts"]),
    );
    expect(captured[0]?.strategyOverride).toMatchObject({
      strategy: "discover_and_plan",
      skipDiscover: true,
      useBuildEvidence: false,
    });
    expect(taskLists[0]).toMatchObject({
      source: "discovery",
      purpose: "discovery",
      title: "Investigating request",
    });
    expect(taskLists.at(-1)).toMatchObject({
      source: "plan",
      purpose: "execution",
    });
    expect(result.taskList?.source).toBe("plan");
    expect(result.taskList?.purpose).toBe("execution");
    expect(result.taskList?.items[0]?.title).toMatch(/client\.ts/);
    expect(
      result.taskList?.items.some((item) =>
        /^(discover|change|verify)$/i.test(item.title),
      ),
    ).toBe(false);
  });

  it("never enters the discovery loop for a Quick exploration depth, even with wide scope", async () => {
    let modelCalls = 0;
    const llm = new ScriptedLlmPort(
      [{ content: "should not run discovery" }],
      createCapabilities({ supportsTools: true }),
    );
    const original = llm.complete.bind(llm);
    llm.complete = async function* (...args) {
      modelCalls += 1;
      yield* original(...args);
    };
    const plan = executionPlan("Rewrite the payments package", "src/payments/client.ts");
    let captured: PlanningInput | undefined;

    const engine = new AgentEnginePipeline(
      createStubDependencies({
        decision: createDecision({
          route: "plan",
          planningDepth: "visible",
          planGate: "none",
          repositoryContextRequired: false,
          toolGrant: createReadOnlyGrant(),
          reasonCodes: ["mode_plan_only"],
        }),
        understanding: createUnderstanding({
          taskAnalysis: {
            ...createUnderstanding().taskAnalysis,
            scope: "repository",
            complexity: "complex",
          },
        }),
        llm,
        planning: {
          plan: async (input) => {
            captured = input;
            return {
              schemaVersion: PLANNING_SCHEMA_VERSION,
              status: "validated",
              plan,
              warnings: [],
              reasonCodes: ["plan_drafted"],
              usedTokens: 10,
              budgetTokens: 1_200,
              durationMs: 1,
              strategy: {
                schemaVersion: 1,
                strategy: "plan_from_ask",
                rationale: "Quick exploration depth plans directly from the ask.",
                skipDiscover: true,
                useBuildEvidence: false,
              },
            };
          },
        },
      }),
    );

    const handle = engine.start({
      ...planStartInput("Rewrite the payments package for clarity."),
      explorationDepth: "quick",
    });
    for await (const _event of handle.events) {
      // drain
    }
    const result = await handle.result;

    expect(result.status).toBe("completed");
    expect(modelCalls).toBe(0);
    expect(captured?.strategyOverride?.strategy).toBe("plan_from_ask");
    expect(result.reasonCodes).not.toContain("discovery_started");
  });
});
