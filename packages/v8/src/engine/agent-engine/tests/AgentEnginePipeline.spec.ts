import { describe, expect, it } from "vitest";

import {
  AgentEngineError,
  AgentEnginePipeline,
  agentEngineStartInputSchema,
  agentRunResultSchema,
  runEventSchema,
} from "..";
import { assembleToolCalls } from "../actions";
import type { DecisionPolicyInput } from "../../../modules/decision-policy";
import type { ModelRequest } from "../../../modules/model-gateway";
import type { PlanningInput } from "../../../modules/planning";
import {
  CharacterTokenEstimator,
  type PromptConstructionInput,
} from "../../../modules/prompt-construction";
import {
  deriveContextSelectionBudget,
  type RepositoryContextPipelineInput,
} from "../../../modules/repository-context";
import type { VerificationInput } from "../../../modules/verification";
import {
  WINDOW_BUDGET_SCHEMA_VERSION,
  deriveWindowPolicy,
} from "../../../modules/window-budget";
import { DEFAULT_TOOL_DEFINITIONS } from "../policy";
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

  it("nudges execute+write when the model dumps a diagnosis instead of apply_patch", async () => {
    const engine = new AgentEnginePipeline(
      createStubDependencies({
        decision: createDecision({
          route: "execute",
          toolGrant: createReadOnlyGrant({
            maximumWorkspaceEffect: "write",
            allowedTools: ["apply_patch"],
            allowedEffects: ["workspace_write"],
            approvalMode: "never",
            mutationBudget: {
              maxPatchesPerCall: 8,
              maxUniqueFilesPerCall: 5,
              maxPatchPayloadCharacters: 24_000,
              preferredBatchSize: 3,
              requireBatchedExecution: false,
            },
          }),
          reasonCodes: ["mutation_execute"],
        }),
        understanding: createUnderstanding({
          intent: {
            status: "accepted",
            classification: {
              interactionIntent: "act",
              primaryTaskIntent: "bugfix",
              secondaryTaskIntents: [],
              confidence: 0.9,
              alternatives: [],
              needsClarification: false,
              reason: "Fixture.",
            },
            scores: [
              {
                intent: "bugfix",
                score: 0.9,
                ruleScore: 0.8,
                llmScore: 0.9,
              },
            ],
            confidenceMargin: 0.4,
            recommendsClarification: false,
            diagnostics: {
              llmPrimaryIntent: "bugfix",
              llmInteractionIntent: "act",
              taskAgreement: true,
              interactionAgreement: true,
              interactionConflict: false,
              agreementBonusApplied: 0,
              disagreementPenaltyApplied: 0,
              minimumConfidence: 0.6,
              minimumMargin: 0.15,
            },
          },
        }),
        llm: new ScriptedLlmPort([
          {
            content:
              "Now I have a clear picture of the codebase. Let me analyze the TypeScript errors:\n1. field should be the config object, not a string.",
          },
          {
            content: "",
            toolCalls: [
              {
                id: "call_patch",
                name: "apply_patch",
                arguments: JSON.stringify({
                  patches: [
                    {
                      path: "src/types.ts",
                      oldText: "field: string",
                      newText: "field: FieldConfig",
                    },
                  ],
                }),
              },
            ],
          },
          { content: "Updated the field config type." },
        ]),
        toolResults: {
          apply_patch: {
            status: "succeeded",
            output: {
              checkpointId: "cp_fix",
              changedFiles: ["src/types.ts"],
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
          userMessage: "Fix all ts errors in this package",
          workspace: { workspaceId: "ws_1" },
        },
      }),
    ).result;

    expect(result.status).toBe("completed");
    expect(result.reasonCodes).toContain("unfulfilled_execute_recovered");
    expect(result.reasonCodes).toContain("mutation_applied");
    expect(result.answer).toContain("Updated the field config type");
  });

  it("does not continue truncated essays on execute+write; asks for apply_patch instead", async () => {
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
        understanding: createUnderstanding({
          intent: {
            status: "accepted",
            classification: {
              interactionIntent: "act",
              primaryTaskIntent: "bugfix",
              secondaryTaskIntents: [],
              confidence: 0.9,
              alternatives: [],
              needsClarification: false,
              reason: "Fixture.",
            },
            scores: [
              {
                intent: "bugfix",
                score: 0.9,
                ruleScore: 0.8,
                llmScore: 0.9,
              },
            ],
            confidenceMargin: 0.4,
            recommendsClarification: false,
            diagnostics: {
              llmPrimaryIntent: "bugfix",
              llmInteractionIntent: "act",
              taskAgreement: true,
              interactionAgreement: true,
              interactionConflict: false,
              agreementBonusApplied: 0,
              disagreementPenaltyApplied: 0,
              minimumConfidence: 0.6,
              minimumMargin: 0.15,
            },
          },
        }),
        llm: new ScriptedLlmPort([
          {
            content: "Here is a long diagnosis of every TypeScript error that got cut off mid-sent",
            finishReason: "length",
          },
          {
            content: "",
            toolCalls: [
              {
                id: "call_patch",
                name: "apply_patch",
                arguments: JSON.stringify({
                  patches: [
                    {
                      path: "src/a.ts",
                      oldText: "x",
                      newText: "y",
                    },
                  ],
                }),
              },
            ],
          },
          { content: "Applied the first batch." },
        ]),
        toolResults: {
          apply_patch: {
            status: "succeeded",
            output: {
              checkpointId: "cp_2",
              changedFiles: ["src/a.ts"],
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
          userMessage: "Fix the type errors",
          workspace: { workspaceId: "ws_1" },
        },
      }),
    ).result;

    expect(result.status).toBe("completed");
    expect(result.reasonCodes).toContain("output_truncation_recovered");
    expect(result.reasonCodes).toContain("mutation_applied");
    expect(result.answer).not.toContain("second half");
  });

  it("does not keep a truncated analysis dump as the answer after mutations", async () => {
    const dump = [
      "Let me analyze the remaining errors:",
      ...Array.from(
        { length: 12 },
        (_, index) =>
          `Let me think about remaining class ${index}. I will apply_patch after I finish this plan.`,
      ),
    ].join("\n");
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
        understanding: createUnderstanding({
          intent: {
            status: "accepted",
            classification: {
              interactionIntent: "act",
              primaryTaskIntent: "bugfix",
              secondaryTaskIntents: [],
              confidence: 0.9,
              alternatives: [],
              needsClarification: false,
              reason: "Fixture.",
            },
            scores: [
              {
                intent: "bugfix",
                score: 0.9,
                ruleScore: 0.8,
                llmScore: 0.9,
              },
            ],
            confidenceMargin: 0.4,
            recommendsClarification: false,
            diagnostics: {
              llmPrimaryIntent: "bugfix",
              llmInteractionIntent: "act",
              taskAgreement: true,
              interactionAgreement: true,
              interactionConflict: false,
              agreementBonusApplied: 0,
              disagreementPenaltyApplied: 0,
              minimumConfidence: 0.6,
              minimumMargin: 0.15,
            },
          },
        }),
        llm: new ScriptedLlmPort([
          {
            content: "",
            toolCalls: [
              {
                id: "call_patch_1",
                name: "apply_patch",
                arguments: JSON.stringify({
                  patches: [{ path: "src/a.ts", oldText: "x", newText: "y" }],
                }),
              },
            ],
          },
          {
            content: dump,
            finishReason: "length",
          },
          {
            content: "",
            toolCalls: [
              {
                id: "call_patch_2",
                name: "apply_patch",
                arguments: JSON.stringify({
                  patches: [{ path: "src/b.ts", oldText: "u", newText: "v" }],
                }),
              },
            ],
          },
          { content: "Updated src/b.ts so the remaining type error is gone." },
        ]),
        toolResults: {
          apply_patch: {
            status: "succeeded",
            output: {
              checkpointId: "cp_post",
              changedFiles: ["src/a.ts", "src/b.ts"],
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
          userMessage: "Fix the type errors",
          workspace: { workspaceId: "ws_1" },
        },
      }),
    ).result;

    expect(result.status).toBe("completed");
    expect(result.reasonCodes).toContain("output_truncation_recovered");
    expect(result.reasonCodes).toContain("mutation_applied");
    expect(result.answer).toContain("Updated src/b.ts");
    expect(result.answer).not.toContain("Let me analyze the remaining errors");
  });

  it("exhausts a single unfulfilled-execute recovery then fails without edits", async () => {
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
        understanding: createUnderstanding({
          intent: {
            ...createUnderstanding().intent,
            classification: {
              ...createUnderstanding().intent.classification,
              interactionIntent: "act",
              primaryTaskIntent: "bugfix",
            },
          },
        }),
        llm: new ScriptedLlmPort([
          { content: "Here are all the TypeScript errors I found." },
          { content: "Here is the same diagnosis again without patches." },
        ]),
      }),
    );

    const result = await engine.start(
      baseStartInput({
        workspaceRoot: "/repo",
        request: {
          sessionId: "sess_1",
          mode: "agent",
          userMessage: "Fix the type errors",
          workspace: { workspaceId: "ws_1" },
        },
      }),
    ).result;

    expect(result.status).toBe("failed");
    expect(result.reasonCodes).toContain("unfulfilled_execute_recovered");
    expect(result.reasonCodes).toContain("unfulfilled_execute_exhausted");
    expect(result.reasonCodes).not.toContain("mutation_applied");
    expect(result.error?.code).toBe("no_mutation_performed");
  });

  it("completes repository_answer analysis without forcing apply_patch", async () => {
    const engine = new AgentEnginePipeline(
      createStubDependencies({
        decision: createDecision({
          route: "repository_answer",
          toolGrant: createReadOnlyGrant(),
          reasonCodes: ["repository_grounded_answer"],
        }),
        llm: new ScriptedLlmPort(
          [
            {
              content:
                "The parser returns null when the token stream is empty. That is expected for this API.",
            },
          ],
          createCapabilities({ supportsTools: false }),
        ),
      }),
    );

    const result = await engine.start(
      baseStartInput({
        request: {
          sessionId: "sess_1",
          mode: "ask",
          userMessage: "What happens when the parser is empty?",
          workspace: { workspaceId: "ws_1" },
        },
      }),
    ).result;

    expect(result.status).toBe("completed");
    expect(result.answer).toContain("parser returns null");
    expect(result.reasonCodes).not.toContain("unfulfilled_execute_recovered");
    expect(result.reasonCodes).toContain("answer_produced");
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
    const contextReady = events.find(
      (event): event is {
        type: "context_ready";
        blockCount: number;
        retrievedCandidates: number;
        selectedItems: number;
        droppedBlocks: number;
      } => (event as { type?: string }).type === "context_ready",
    );
    expect(contextReady).toMatchObject({
      blockCount: 1,
      retrievedCandidates: 1,
      selectedItems: 1,
      droppedBlocks: 0,
      retrievalSources: [
        {
          sourceId: "text-index",
          status: "complete",
          candidateCount: 1,
        },
      ],
    });
    const toolStarted = events.find(
      (event): event is { type: "tool_started"; summary?: string } =>
        (event as { type?: string }).type === "tool_started",
    );
    expect(toolStarted?.summary).toBe("path=src/auth.ts");
    for (const event of events) {
      expect(() => runEventSchema.parse(event)).not.toThrow();
    }
  });

  it("emits required retrieval warnings from context_ready", async () => {
    const dependencies = createStubDependencies({
      decision: createDecision({
        route: "repository_answer",
        repositoryContextRequired: true,
        pinnedState: { workspaceId: "ws_1", stateToken: "tok_1" },
        toolGrant: createReadOnlyGrant(),
      }),
      llm: new ScriptedLlmPort([{ content: "done" }], createCapabilities({
        supportsTools: false,
      })),
    });
    const originalExecute = dependencies.repositoryContext?.execute.bind(
      dependencies.repositoryContext,
    );
    dependencies.repositoryContext = {
      execute: async (input) => {
        const result = await originalExecute!(input);
        return {
          ...result,
          warnings: [
            {
              stage: "retrieval",
              code: "required_source_unavailable",
              message:
                "Pinned repository state does not expose a ready text index.",
            },
          ],
        };
      },
    };

    const handle = new AgentEnginePipeline(dependencies).start(
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
    const events = await collectEvents(handle.events);
    await handle.result;

    expect(
      events.some(
        (event) =>
          event.type === "warning" &&
          "message" in event &&
          /ready text index/.test(String(event.message)),
      ),
    ).toBe(true);
  });

  it("does not narrow the write grant from assembled paths outside the mentioned folder", async () => {
    let discoveredPaths: readonly string[] | undefined;
    const understanding = createUnderstanding();
    const dependencies = createStubDependencies({
      understanding: createUnderstanding({
        taskAnalysis: {
          ...understanding.taskAnalysis,
          targets: [
            { kind: "folder", value: "packages/demo", explicit: true },
          ],
        },
      }),
      decision: createDecision({
        route: "repository_answer",
        repositoryContextRequired: true,
        pinnedState: { workspaceId: "ws_1", stateToken: "tok_1" },
        toolGrant: createReadOnlyGrant({
          maximumWorkspaceEffect: "write",
          pathScopes: ["packages/demo"],
        }),
      }),
      contextBlocks: [
        {
          id: "ignore",
          relativePath: ".gitignore",
          content: "node_modules",
        },
        {
          id: "docs",
          relativePath: "apps/docs/readme.md",
          content: "docs",
        },
      ],
      llm: new ScriptedLlmPort([{ content: "done" }], createCapabilities({
        supportsTools: false,
      })),
    });
    dependencies.decision.narrow = (input) => {
      discoveredPaths = input.discoveredPaths;
      return input.previous;
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
            mode: "agent",
            userMessage: "fix types in @packages/demo",
            workspace: { workspaceId: "ws_1" },
          },
        }),
      )
      .result;

    expect(result.status).toBe("completed");
    expect(discoveredPaths).toEqual([]);
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
    const expectedBudget = deriveContextSelectionBudget(252_000, {
      maximumTokens: deriveWindowPolicy({
        schemaVersion: WINDOW_BUDGET_SCHEMA_VERSION,
        contextWindowTokens: 252_000,
        maximumOutputTokens: 64_000,
        toolSchemaTokens: new CharacterTokenEstimator().estimate(
          JSON.stringify(DEFAULT_TOOL_DEFINITIONS),
        ),
      }).sections.repositoryTokens,
    });
    expect(capturedContextInput?.selectionBudget).toEqual(expectedBudget);
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
    const secondRequestToolArguments =
      captured[1]?.messages
        .flatMap((message) => message.toolCalls ?? [])
        .map((toolCall) => toolCall.arguments) ?? [];

    expect(result.status).toBe("completed");
    expect(captured).toHaveLength(3);
    expect(secondRequestText).not.toContain("a".repeat(1_000));
    expect(secondRequestText).not.toContain("oldText");
    expect(secondRequestToolArguments).toContain(
      JSON.stringify({ path: "src/large.ts" }),
    );
    expect(result.warnings).toContain(
      "Compacted previous tool call history to keep follow-up model calls within the context budget.",
    );
  });

  it("does not continue transitional narration after a successful verification command", async () => {
    const llm = new ScriptedLlmPort(
      [
        {
          toolCalls: [
            {
              id: "patch_1",
              name: "apply_patch",
              arguments: JSON.stringify({
                patches: [
                  {
                    path: "src/field.ts",
                    oldText: "type Broken = string",
                    newText: "type Fixed = string",
                  },
                ],
              }),
            },
          ],
        },
        {
          toolCalls: [
            {
              id: "build_1",
              name: "run_readonly_command",
              arguments: JSON.stringify({
                argv: [
                  "npm",
                  "run",
                  "build",
                  "--workspace",
                  "packages/mui-builder",
                ],
              }),
            },
          ],
        },
        {
          content:
            "Build passes now. Let me inspect the remaining field files before I summarize:",
        },
        {
          toolCalls: [
            {
              id: "wander_1",
              name: "read_file",
              arguments: JSON.stringify({ path: "src/unrelated.ts" }),
            },
          ],
        },
      ],
    );

    const engine = new AgentEnginePipeline(
      createStubDependencies({
        decision: createDecision({
          route: "execute",
          planningDepth: "visible",
          repositoryContextRequired: false,
          toolGrant: createReadOnlyGrant({
            maximumWorkspaceEffect: "write",
            allowedTools: ["apply_patch", "run_readonly_command", "read_file"],
            allowedEffects: [
              "workspace_read",
              "workspace_write",
              "process_execute",
            ],
          }),
          reasonCodes: ["mutation_execute"],
        }),
        llm,
        toolResults: {
          apply_patch: {
            output: {
              checkpointId: "chk_1",
              changedFiles: ["src/field.ts"],
            },
          },
          run_readonly_command: {
            output: {
              argv: [
                "npm",
                "run",
                "build",
                "--workspace",
                "packages/mui-builder",
              ],
              exitCode: 0,
              stdout: "",
              stderr: "",
              truncated: false,
            },
          },
        },
      }),
    );

    const handle = engine.start(
      baseStartInput({
        workspaceRoot: "/repo",
        request: {
          sessionId: "sess_1",
          mode: "agent",
          userMessage: "Fix all TypeScript issues in packages/mui-builder",
          workspace: { workspaceId: "ws_1" },
        },
      }),
    );
    const [result, events] = await Promise.all([
      handle.result,
      collectEvents(handle.events),
    ]);

    expect(result.status).toBe("completed");
    expect(result.answer).toContain("Completed workspace edits");
    expect(result.answer).toContain("src/field.ts");
    expect(result.reasonCodes).toContain("incomplete_answer_fallback");
    expect(result.evidence?.finalStopReason).toContain("Completed");
    expect(result.evidence?.ledger.some((entry) => entry.kind === "edit")).toBe(
      true,
    );
    expect(
      result.evidence?.ledger.some((entry) => entry.kind === "verification"),
    ).toBe(true);
    expect(result.evidence?.ledger.at(-1)?.kind).toBe("stop");
    expect(
      events.some(
        (event) =>
          typeof event === "object" &&
          event !== null &&
          "type" in event &&
          event.type === "tool_started" &&
          "toolName" in event &&
          event.toolName === "read_file",
      ),
    ).toBe(false);
    expect(
      events.some(
        (event) =>
          typeof event === "object" &&
          event !== null &&
          "type" in event &&
          event.type === "evidence_updated",
      ),
    ).toBe(true);
    for (const event of events) {
      expect(() => runEventSchema.parse(event)).not.toThrow();
    }
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

  it("emits bounded diagnostics for rejected tool results", async () => {
    const engine = new AgentEnginePipeline(
      createStubDependencies({
        decision: createDecision({
          route: "execute",
          toolGrant: createReadOnlyGrant({
            maximumWorkspaceEffect: "write",
            allowedTools: ["apply_patch", "read_file"],
            allowedEffects: ["workspace_write", "workspace_read"],
            approvalMode: "never",
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
          { content: "Cannot continue without a valid patch." },
        ]),
        toolResults: {
          apply_patch: {
            status: "rejected",
            reasonCode: "patch_conflict",
            warnings: ['oldText not found in "src/a.ts"'],
          },
        },
      }),
    );

    const handle = engine.start(baseStartInput({ workspaceRoot: "/repo" }));
    const [, events] = await Promise.all([
      handle.result,
      collectEvents(handle.events),
    ]);

    const completed = events
      .map((event) => runEventSchema.parse(event))
      .find(
        (event) =>
          event.type === "tool_completed" &&
          event.toolName === "apply_patch",
      );

    expect(completed).toMatchObject({
      status: "rejected",
      reasonCode: "patch_conflict",
      warnings: ['oldText not found in "src/a.ts"'],
      durationMs: expect.any(Number),
      bytesProduced: expect.any(Number),
      truncated: false,
      redacted: false,
    });
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

  it("preserves an explicit unlimited run budget on the start contract", () => {
    const parsed = baseStartInput({
      budget: {
        unlimited: true,
        maxModelCalls: 1_000_000,
        maxToolCalls: 1_000_000,
        maxLoopIterations: 1_000_000,
        maxWallTimeMs: 60_000,
      },
    });
    expect(parsed.budget?.unlimited).toBe(true);
    expect(parsed.budget?.maxModelCalls).toBe(1_000_000);
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
              targetRefs: ["src/auth/login.ts"],
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
          plan: async () => ({
            schemaVersion: PLANNING_SCHEMA_VERSION,
            status: "validated",
            plan: mockPlan,
            warnings: [],
            reasonCodes: ["plan_drafted", "plan_validated"],
            usedTokens: 40,
            budgetTokens: 1_200,
            durationMs: 1,
            strategy: {
              schemaVersion: 1 as const,
              strategy: "discover_and_plan" as const,
              rationale: "Migration needs discovery first.",
              skipDiscover: false,
              useBuildEvidence: false,
            },
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
    expect(result.planStrategy?.strategy).toBe("discover_and_plan");
    expect(result.evidence?.plan?.stepCount).toBe(1);
    expect(result.evidence?.plan?.evidenceLinkedStepCount).toBe(1);
    expect(modelCalls).toBe(0);
    expect(result.reasonCodes).toContain("plan_approval_suspended");

    const resumedLlm = new ScriptedLlmPort([{ content: "Executed after plan." }]);
    const resumedRequests: ModelRequest[] = [];
    const originalResume = resumedLlm.complete.bind(resumedLlm);
    resumedLlm.complete = async function* (request: ModelRequest) {
      resumedRequests.push(request);
      yield* originalResume(request);
    };
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
          plan: async () => ({
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
    expect(resumed.planStrategy?.strategy).toBe("discover_and_plan");
    const resumedSystem = resumedRequests[0]?.messages.find(
      (message) => message.role === "system",
    );
    expect(resumedSystem?.content).toContain(
      "discovery already ran",
    );
  });

  it("captures preflight build state before planning and passes evidence into Planning", async () => {
    let capturedVerificationInput: VerificationInput | undefined;
    let capturedPlanningInput: PlanningInput | undefined;
    const repoBuildStateBefore = {
      schemaVersion: 1 as const,
      capturedAt: "2026-08-14T12:00:00.000Z",
      phase: "before" as const,
      scope: {
        workspaceRoot: "/repo",
        folderPrefixes: ["packages/mui-builder"],
        projectIds: ["mui-builder"],
        changeScope: "module" as const,
      },
      checks: [
        {
          checkId: "mui-builder:typecheck",
          kind: "typecheck" as const,
          projectId: "mui-builder",
          label: "typecheck",
          evidenceSource: "package.json",
          outcome: "failed" as const,
          exitCode: 2,
          summary: "Typecheck failed.",
        },
      ],
      diagnostics: [
        {
          path: "packages/mui-builder/src/Button.tsx",
          severity: "error" as const,
          message: "Type mismatch",
          startLine: 12,
          source: "tsc",
          code: "TS2322",
          checkId: "mui-builder:typecheck",
        },
      ],
      summary: {
        errorCount: 1,
        warningCount: 0,
        failedCheckIds: ["mui-builder:typecheck"],
      },
      reasonCodes: ["checks_failed" as const],
    };

    const plan = {
      schemaVersion: 1 as const,
      objective: "Fix mui-builder type errors",
      assumptions: [],
      openQuestions: [],
      contextReviewed: [],
      constraints: [],
      dimensions: {
        scope: "package",
        risk: "low" as const,
        clarity: "clear",
        complexity: "moderate",
        changeImpact: ["code" as const],
      },
      phases: [
        {
          id: "phase-change",
          name: "Change",
          purpose: "Fix diagnostics",
          steps: [
            {
              id: "step-1",
              intent: "Fix packages/mui-builder/src/Button.tsx",
              targetRefs: ["packages/mui-builder/src/Button.tsx"],
              actionSummary: "Resolve the reported type mismatch.",
              expectedOutcome: "Typecheck is clean.",
              riskLevel: "low" as const,
            },
          ],
          dependencies: [],
          successCriteria: ["Diagnostics are resolved."],
        },
      ],
      risks: [],
      alternatives: [],
      verification: { checks: ["typecheck"], manualQa: [], commands: [] },
      rollback: "Revert the type-error fixes.",
      approvalRequired: false,
      processHintsApplied: [],
    };

    const baseUnderstanding = createUnderstanding();
    const engine = new AgentEnginePipeline(
      createStubDependencies({
        decision: createDecision({
          route: "execute",
          planningDepth: "visible",
          planGate: "required_before_execute",
          repositoryContextRequired: false,
          pinnedState: { workspaceId: "ws_1", stateToken: "tok_1" },
          toolGrant: createReadOnlyGrant({
            maximumWorkspaceEffect: "write",
            allowedTools: ["run_readonly_command", "read_diagnostics"],
            allowedEffects: ["workspace_read", "process_execute"],
          }),
          verification: {
            required: true,
            minimumEvidence: ["diagnostics", "typecheck"],
            allowUnavailable: false,
          },
          reasonCodes: [
            "mutation_execute",
            "broad_repair_visible_plan",
            "preflight_build_recommended",
            "plan_gate_required",
          ],
        }),
        understanding: createUnderstanding({
          intent: {
            ...baseUnderstanding.intent,
            classification: {
              ...baseUnderstanding.intent.classification,
              interactionIntent: "act",
              primaryTaskIntent: "bugfix",
            },
          },
          taskAnalysis: {
            ...baseUnderstanding.taskAnalysis,
            scope: "package",
            complexity: "moderate",
            targets: [
              {
                kind: "folder",
                value: "packages/mui-builder",
                explicit: true,
              },
            ],
            recommendsPlanning: true,
            recommendsVerification: true,
          },
        }),
        verification: {
          verify: async () => {
            throw new Error("post-mutation verification should not run");
          },
          captureBuildState: async (input) => {
            capturedVerificationInput = input;
            return repoBuildStateBefore;
          },
          buildStateFromResult: () => repoBuildStateBefore,
          compareBuildStates: () => ({
            beforeErrorCount: 1,
            afterErrorCount: 0,
            clearedErrorCount: 1,
            newErrorCount: 0,
            remainingErrorCount: 0,
            failedCheckIdsBefore: ["mui-builder:typecheck"],
            failedCheckIdsAfter: [],
            reasonCodes: ["errors_cleared"],
          }),
        },
        planning: {
          plan: async (input) => {
            capturedPlanningInput = input;
            return {
              schemaVersion: 1,
              status: "validated",
              plan,
              warnings: [],
              reasonCodes: ["plan_drafted", "plan_validated"],
              usedTokens: 20,
              budgetTokens: 1_200,
              durationMs: 1,
            };
          },
        },
      }),
    );

    const result = await engine.start(
      baseStartInput({
        request: {
          sessionId: "sess_1",
          mode: "agent",
          userMessage: "@packages/mui-builder fix all the ts errors",
          workspace: { workspaceId: "ws_1" },
        },
        workspaceRoot: "/repo",
        repositoryState: {
          reference: { workspaceId: "ws_1", stateToken: "tok_1" },
          readiness: "ready",
        },
        projects: [
          {
            projectId: "mui-builder",
            rootPath: "packages/mui-builder",
            primaryLanguageId: "typescript",
            manifestPaths: ["packages/mui-builder/package.json"],
          },
        ],
      }),
    ).result;

    expect(result.status).toBe("suspended");
    expect(result.repoBuildStateBefore?.summary.errorCount).toBe(1);
    expect(result.reasonCodes).toContain("repo_build_state_before_captured");
    // Agent-mode preflight capture runs before Understand, so it has no
    // taskAnalysis targets yet — but it scopes itself from an explicit
    // "@packages/mui-builder" mention in the raw query, so it still checks
    // the right project instead of falling back to a repo-root snapshot
    // that would never discover the package's build/typecheck scripts.
    expect(capturedVerificationInput?.changedFiles).toEqual([
      "packages/mui-builder",
    ]);
    expect(capturedVerificationInput?.changeScope).toBe("module");
    expect(capturedPlanningInput?.explorationDepth).toBe("auto");
  expect(capturedPlanningInput?.buildEvidence?.diagnostics?.[0]?.path).toBe(
    "packages/mui-builder/src/Button.tsx",
  );
});

  it("does not capture preflight for a yes/no implementation status question", async () => {
    let captureCalls = 0;
    const llm = new ScriptedLlmPort(
      [{ content: "Headless is configured in wdio.desktop.conf.ts." }],
      createCapabilities({ supportsTools: false }),
    );
    const engine = new AgentEnginePipeline(
      createStubDependencies({
        llm,
        verification: {
          verify: async () => {
            throw new Error("post-mutation verification should not run");
          },
          captureBuildState: async () => {
            captureCalls += 1;
            throw new Error("preflight should not run for a status question");
          },
        },
      }),
    );

    const result = await engine.start(
      baseStartInput({
        request: {
          sessionId: "sess_headless_question",
          mode: "agent",
          userMessage: "is headless implemented ??",
          workspace: { workspaceId: "ws_1" },
        },
        workspaceRoot: "/repo",
        repositoryState: {
          reference: { workspaceId: "ws_1", stateToken: "tok_1" },
          readiness: "ready",
        },
      }),
    ).result;

    expect(captureCalls).toBe(0);
    expect(result.status).toBe("completed");
    expect(result.reasonCodes).not.toContain("repo_build_state_before_captured");
  });

it("injects scoped preflight diagnostics into execute repair prompts", async () => {
  const repoBuildStateBefore = {
    schemaVersion: 1 as const,
    capturedAt: "2026-08-14T12:00:00.000Z",
    phase: "before" as const,
    scope: {
      workspaceRoot: "/repo",
      folderPrefixes: ["packages/mui-builder"],
      projectIds: ["mui-builder"],
      changeScope: "module" as const,
    },
    checks: [
      {
        checkId: "mui-builder:typecheck",
        kind: "typecheck" as const,
        projectId: "mui-builder",
        label: "typecheck",
        evidenceSource: "package.json",
        outcome: "failed" as const,
        exitCode: 2,
        summary: "Typecheck failed.",
      },
    ],
    diagnostics: [
      {
        path: "packages/mui-builder/src/Button.tsx",
        severity: "error" as const,
        message: "Type mismatch",
        startLine: 12,
        source: "tsc",
        code: "TS2322",
        checkId: "mui-builder:typecheck",
      },
      {
        path: "packages/other/src/Other.ts",
        severity: "error" as const,
        message: "Out of scope.",
        startLine: 1,
        source: "tsc",
        code: "TS1000",
      },
    ],
    summary: {
      errorCount: 2,
      warningCount: 0,
      failedCheckIds: ["mui-builder:typecheck"],
    },
    reasonCodes: ["checks_failed" as const],
  };
  const llm = new ScriptedLlmPort(
    [
      { content: "I will inspect first." },
      { content: "Still no patch." },
    ],
    createCapabilities({ supportsTools: true }),
  );
  const baseUnderstanding = createUnderstanding();
  const engine = new AgentEnginePipeline(
    createStubDependencies({
      decision: createDecision({
        route: "execute",
        repositoryContextRequired: false,
        toolGrant: createReadOnlyGrant({
          maximumWorkspaceEffect: "write",
          allowedTools: ["read_file", "apply_patch"],
          allowedEffects: ["workspace_read", "workspace_write"],
          pathScopes: ["packages/mui-builder"],
        }),
        reasonCodes: ["mutation_execute", "preflight_build_recommended"],
      }),
      understanding: createUnderstanding({
        intent: {
          ...baseUnderstanding.intent,
          classification: {
            ...baseUnderstanding.intent.classification,
            interactionIntent: "act",
            primaryTaskIntent: "bugfix",
          },
        },
      }),
      llm,
      verification: {
        verify: async () => {
          throw new Error("verification should not run without mutations");
        },
        captureBuildState: async () => repoBuildStateBefore,
        buildStateFromResult: () => repoBuildStateBefore,
        compareBuildStates: () => ({
          beforeErrorCount: 2,
          afterErrorCount: 2,
          clearedErrorCount: 0,
          newErrorCount: 0,
          remainingErrorCount: 2,
          failedCheckIdsBefore: ["mui-builder:typecheck"],
          failedCheckIdsAfter: ["mui-builder:typecheck"],
          reasonCodes: ["errors_remaining"],
        }),
      },
    }),
  );

  await engine.start(
    baseStartInput({
      request: {
        sessionId: "sess_preflight_diagnostic_prompt",
        mode: "agent",
        userMessage: "@packages/mui-builder fix all ts errors",
        workspace: { workspaceId: "ws_1" },
      },
      workspaceRoot: "/repo",
      repositoryState: {
        reference: { workspaceId: "ws_1", stateToken: "tok_1" },
        readiness: "ready",
      },
    }),
  ).result;

  const prompt = (llm.requests[0]?.messages ?? [])
    .map((message) => message.content)
    .join("\n");
  expect(prompt).toContain("Preflight verification already captured 2");
  expect(prompt).toContain("packages/mui-builder/src/Button.tsx:12 TS2322");
  expect(prompt).toContain("call apply_patch");
  expect(prompt).not.toContain("packages/other");
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
              targetRefs: ["src/auth/login.ts"],
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
          plan: async () => ({
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
              targetRefs: ["apps/vscode/src/extension.ts"],
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
          plan: async () => {
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
    const prompt = (captured[0]?.messages ?? [])
      .map((message) => message.content)
      .join("\n");
    expect(prompt).toContain("<approved_plan");
    expect(prompt).toContain("Ship conversation carry");
    expect(prompt).toContain("## Checklist");
    expect(prompt).toContain("Pass conversation + plan");
  });

  it("keeps a follow_evidence contract on a host-carried concrete repair plan", async () => {
    const { PLANNING_SCHEMA_VERSION } = await import(
      "../../../modules/planning"
    );
    const carriedPlan = {
      schemaVersion: PLANNING_SCHEMA_VERSION,
      objective: "Fix mui-builder type errors",
      assumptions: [],
      openQuestions: [],
      contextReviewed: [],
      constraints: [],
      dimensions: {
        scope: "package",
        risk: "low" as const,
        clarity: "clear",
        complexity: "moderate",
        changeImpact: ["code" as const],
      },
      phases: [
        {
          id: "phase-change",
          name: "Change",
          purpose: "Fix diagnostics",
          steps: [
            {
              id: "step-1",
              intent: "Fix packages/mui-builder/src/Button.tsx:12 TS2322",
              targetRefs: ["packages/mui-builder/src/Button.tsx"],
              actionSummary: "Resolve the reported type mismatch.",
              expectedOutcome: "Typecheck is clean.",
              riskLevel: "low" as const,
            },
          ],
          dependencies: [],
          successCriteria: ["Diagnostics are resolved."],
        },
      ],
      risks: [],
      alternatives: [],
      verification: { checks: ["typecheck"], manualQa: [], commands: [] },
      rollback: "Revert the type-error fixes.",
      approvalRequired: false,
      processHintsApplied: [],
    };
    const llm = new ScriptedLlmPort(
      [{ content: "Fixing the active diagnostic." }],
      createCapabilities({ supportsTools: false }),
    );
    const captured: ModelRequest[] = [];
    const original = llm.complete.bind(llm);
    llm.complete = async function* (request: ModelRequest) {
      captured.push(request);
      yield* original(request);
    };
    const engine = new AgentEnginePipeline(
      createStubDependencies({
        decision: createDecision({
          route: "execute",
          planningDepth: "visible",
          planGate: "none",
          repositoryContextRequired: false,
          toolGrant: createReadOnlyGrant(),
          reasonCodes: ["mutation_execute"],
        }),
        llm,
      }),
    );

    const result = await engine.start(
      baseStartInput({
        approvedPlan: carriedPlan,
        request: {
          sessionId: "sess_1",
          mode: "agent",
          userMessage: "Continue the repair",
          workspace: { workspaceId: "ws_1" },
        },
        workspaceRoot: "/repo",
      }),
    ).result;

    expect(result.planStrategy?.strategy).toBe("follow_evidence");
    const system = captured[0]?.messages.find((message) => message.role === "system");
    expect(system?.content).toContain("Skip rediscovery");
  });

  it("prefers a host-carried approvedPlanStrategy over artifact inference", async () => {
    const { PLANNING_SCHEMA_VERSION } = await import(
      "../../../modules/planning"
    );
    const carriedPlan = {
      schemaVersion: PLANNING_SCHEMA_VERSION,
      objective: "Fix mui-builder type errors",
      assumptions: [],
      openQuestions: [],
      contextReviewed: [],
      constraints: [],
      dimensions: {
        scope: "package",
        risk: "low" as const,
        clarity: "clear",
        complexity: "moderate",
        changeImpact: ["code" as const],
      },
      phases: [
        {
          id: "phase-change",
          name: "Change",
          purpose: "Fix diagnostics",
          steps: [
            {
              id: "step-1",
              intent: "Fix packages/mui-builder/src/Button.tsx:12 TS2322",
              targetRefs: ["packages/mui-builder/src/Button.tsx"],
              actionSummary: "Resolve the reported type mismatch.",
              expectedOutcome: "Typecheck is clean.",
              riskLevel: "low" as const,
            },
          ],
          dependencies: [],
          successCriteria: ["Diagnostics are resolved."],
        },
      ],
      risks: [],
      alternatives: [],
      verification: { checks: ["typecheck"], manualQa: [], commands: [] },
      approvalRequired: false,
      processHintsApplied: [],
    };
    const llm = new ScriptedLlmPort(
      [{ content: "Following the carried strategy." }],
      createCapabilities({ supportsTools: false }),
    );
    const captured: ModelRequest[] = [];
    const original = llm.complete.bind(llm);
    llm.complete = async function* (request: ModelRequest) {
      captured.push(request);
      yield* original(request);
    };
    const engine = new AgentEnginePipeline(
      createStubDependencies({
        decision: createDecision({
          route: "execute",
          planningDepth: "visible",
          planGate: "none",
          repositoryContextRequired: false,
          toolGrant: createReadOnlyGrant(),
          reasonCodes: ["mutation_execute"],
        }),
        llm,
      }),
    );

    const result = await engine.start(
      baseStartInput({
        approvedPlan: carriedPlan,
        approvedPlanStrategy: {
          schemaVersion: 1,
          strategy: "plan_from_ask",
          rationale: "Host persisted the original ask-led strategy.",
          skipDiscover: true,
          useBuildEvidence: false,
        },
        request: {
          sessionId: "sess_1",
          mode: "agent",
          userMessage: "Continue the approved plan",
          workspace: { workspaceId: "ws_1" },
        },
        workspaceRoot: "/repo",
      }),
    ).result;

    expect(result.planStrategy?.strategy).toBe("plan_from_ask");
    const system = captured[0]?.messages.find((message) => message.role === "system");
    expect(system?.content).toContain("plan from the approved objective");
    expect(system?.content).not.toContain("Skip rediscovery");
  });

  it("derives window policy once and threads it into decision and prompt", async () => {
    const capturedDecisions: DecisionPolicyInput[] = [];
    const capturedPrompts: PromptConstructionInput[] = [];
    const deps = createStubDependencies({
      decision: createDecision({ route: "direct_answer" }),
      llm: new ScriptedLlmPort(
        [{ content: "Four." }],
        createCapabilities({
          supportsTools: false,
          contextWindowTokens: 30_000,
          maximumOutputTokens: 3_000,
        }),
      ),
    });
    const originalDecide = deps.decision.decide;
    deps.decision.decide = (input) => {
      capturedDecisions.push(input);
      return originalDecide(input);
    };
    const originalConstruct = deps.prompt.construct;
    deps.prompt.construct = (input) => {
      capturedPrompts.push(input);
      return originalConstruct(input);
    };

    const engine = new AgentEnginePipeline(deps);
    const result = await engine.start(baseStartInput()).result;
    expect(result.status).toBe("completed");

    const expected = deriveWindowPolicy({
      schemaVersion: WINDOW_BUDGET_SCHEMA_VERSION,
      contextWindowTokens: 30_000,
      maximumOutputTokens: 3_000,
      toolSchemaTokens: capturedDecisions[0]?.windowPolicy?.toolSchemaTokens,
    });
    expect(capturedDecisions[0]?.windowPolicy?.usableInputTokens).toBe(
      expected.usableInputTokens,
    );
    expect(capturedDecisions[0]?.windowPolicy?.planning.visiblePlanAffordable).toBe(
      true,
    );
    expect(capturedPrompts[0]?.outputReserveTokens).toBe(
      expected.maximumOutputTokens,
    );
  });
});
