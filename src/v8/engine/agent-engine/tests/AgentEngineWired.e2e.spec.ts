import { describe, expect, it } from "vitest";

import {
  agentEngineStartInputSchema,
  agentRunResultSchema,
  runEventSchema,
} from "..";
import type { RunEvent } from "..";
import {
  WIRED_WORKSPACE_ID,
  WIRED_WORKSPACE_ROOT,
  createWiredHarness,
} from "./fixtures/wiredHarness";

function startInput(
  message: string,
  overrides: Record<string, unknown> = {},
) {
  return agentEngineStartInputSchema.parse({
    schemaVersion: 1,
    request: {
      sessionId: "sess_wired",
      mode: "ask",
      userMessage: message,
      workspace: { workspaceId: WIRED_WORKSPACE_ID },
    },
    workspaceRoot: WIRED_WORKSPACE_ROOT,
    ...overrides,
  });
}

async function collectEvents(
  events: AsyncIterable<RunEvent>,
): Promise<RunEvent[]> {
  const collected: RunEvent[] = [];
  for await (const event of events) {
    collected.push(event);
  }
  return collected;
}

function assertSafeEvents(events: RunEvent[]): void {
  for (const event of events) {
    expect(() => runEventSchema.parse(event)).not.toThrow();
    const serialized = JSON.stringify(event);
    expect(serialized).not.toMatch(/sk-[a-zA-Z0-9]/);
    expect(serialized).not.toMatch(/Authorization/i);
    expect(serialized).not.toContain("Bearer ");
  }
}

describe("AgentEnginePipeline wired facades (Phase 7 e2e)", () => {
  it("completes direct_answer with real Intake/Understand/Decide/Prompt/Echo", async () => {
    const { engine, stateReference } = await createWiredHarness({
      understanding: {
        interactionIntent: "question",
        primaryTaskIntent: "question",
        needsClarification: false,
      },
    });

    const handle = engine.start(
      startInput("What is recursion in computer science?", {
        repositoryState: {
          reference: stateReference,
          readiness: "ready",
        },
      }),
    );

    const [result, events] = await Promise.all([
      handle.result,
      collectEvents(handle.events),
    ]);

    expect(agentRunResultSchema.parse(result).status).toBe("completed");
    expect(result.route).toBe("direct_answer");
    expect(result.answer).toBeTruthy();
    // Echo prefixes the user message
    expect(result.answer).toContain("Echo:");
    expect(result.reasonCodes).toContain("answer_produced");
    assertSafeEvents(events);
    expect(events.map((e) => e.type)).toContain("terminal");
    expect(events.some((e) => e.type === "stage_started")).toBe(true);
  });

  it("suspends clarify without model work using real Decision Policy", async () => {
    const { engine, stateReference } = await createWiredHarness({
      understanding: {
        interactionIntent: "act",
        primaryTaskIntent: "bugfix",
        needsClarification: true,
        confidence: 0.4,
        alternatives: [{ intent: "question", confidence: 0.35 }],
      },
    });

    const handle = engine.start(
      startInput("Fix it", {
        repositoryState: {
          reference: stateReference,
          readiness: "ready",
        },
      }),
    );
    const [result, events] = await Promise.all([
      handle.result,
      collectEvents(handle.events),
    ]);

    expect(result.status).toBe("suspended");
    expect(result.suspension?.kind).toBe("clarification_required");
    expect(result.route).toBe("clarify");
    expect(result.usage.modelCalls).toBe(0);
    expect(events.some((e) => e.type === "suspended")).toBe(true);
    assertSafeEvents(events);
  });

  it("completes repository_answer with pin, context, and real tools", async () => {
    const { engine, stateReference } = await createWiredHarness({
        understanding: {
          interactionIntent: "question",
          primaryTaskIntent: "question",
          needsClarification: false,
        },
        runTurns: [
          {
            toolCalls: [
              {
                id: "call_read_auth",
                name: "read_file",
                arguments: JSON.stringify({ path: "src/auth.ts" }),
              },
            ],
          },
          {
            content: "auth.ts exports login().",
          },
        ],
      });

    const handle = engine.start(
      startInput("What does src/auth.ts export?", {
        repositoryState: {
          reference: stateReference,
          readiness: "ready",
        },
      }),
    );

    const [result, events] = await Promise.all([
      handle.result,
      collectEvents(handle.events),
    ]);

    expect(result.status).toBe("completed");
    expect(result.route).toBe("repository_answer");
    expect(result.answer).toContain("login");
    expect(result.usage.toolCalls).toBeGreaterThanOrEqual(1);
    expect(result.usage.modelCalls).toBeGreaterThanOrEqual(2);
    expect(result.reasonCodes).toContain("context_retrieved");
    expect(result.reasonCodes).toContain("tools_executed");
    expect(result.pinnedState?.stateToken).toBe(stateReference.stateToken);

    expect(events.some((e) => e.type === "state_pinned")).toBe(true);
    expect(events.some((e) => e.type === "context_ready")).toBe(true);
    expect(events.some((e) => e.type === "tool_completed")).toBe(true);
    assertSafeEvents(events);
  });

  it("completes diagnose read-only with repository context", async () => {
    const { engine, stateReference } = await createWiredHarness({
      understanding: {
        interactionIntent: "help",
        primaryTaskIntent: "diagnose",
        needsClarification: false,
      },
      runTurns: [
        {
          content: "Root cause: login returns true without validating input.",
        },
      ],
    });

    const result = await engine.start(
      startInput("Why does login fail in src/auth.ts?", {
        repositoryState: {
          reference: stateReference,
          readiness: "ready",
        },
      }),
    ).result;

    expect(result.status).toBe("completed");
    expect(result.route).toBe("diagnose");
    expect(result.answer).toContain("Root cause");
    expect(result.reasonCodes).toContain("context_retrieved");
  });

  it("cancels an in-flight wired model turn", async () => {
    const { engine, stateReference } = await createWiredHarness({
      understanding: {
        interactionIntent: "question",
        primaryTaskIntent: "question",
        needsClarification: false,
      },
      runLlm: {
        id: "slow-cancel-llm",
        capabilities: {
          modelId: "test/cancel",
          contextWindowTokens: 8_192,
          maximumOutputTokens: 1_024,
          supportsStreaming: true,
          supportsTools: false,
          supportsParallelToolCalls: false,
          supportsStructuredOutput: false,
          supportsVision: false,
          supportsReasoning: false,
          supportsPromptCaching: false,
          supportsEmbeddings: false,
        },
        async *complete(_request, context) {
          yield { type: "content_delta" as const, content: "partial" };
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
            type: "cancelled" as const,
            error: {
              code: "cancelled" as const,
              message: "Aborted",
              retryable: false,
            },
          };
        },
      },
    });

    const handle = engine.start(
      startInput("Explain hashing briefly", {
        repositoryState: {
          reference: stateReference,
          readiness: "ready",
        },
      }),
    );
    queueMicrotask(() => handle.cancel("user_cancel"));
    const result = await handle.result;

    expect(result.status).toBe("cancelled");
    expect(result.reasonCodes).toContain("cancelled");
  });

  it("exhausts model budget deterministically on a tool loop", async () => {
    const { engine, stateReference } = await createWiredHarness({
      understanding: {
        interactionIntent: "question",
        primaryTaskIntent: "question",
        needsClarification: false,
      },
      runTurns: [
        {
          toolCalls: [
            {
              id: "t1",
              name: "read_file",
              arguments: JSON.stringify({ path: "src/auth.ts" }),
            },
          ],
        },
        {
          toolCalls: [
            {
              id: "t2",
              name: "read_file",
              arguments: JSON.stringify({ path: "README" }),
            },
          ],
        },
        { content: "should not reach" },
      ],
    });

    const result = await engine.start(
      startInput("What does src/auth.ts export?", {
        repositoryState: {
          reference: stateReference,
          readiness: "ready",
        },
        budget: {
          maxModelCalls: 2,
          maxToolCalls: 10,
          maxLoopIterations: 10,
          maxWallTimeMs: 60_000,
        },
      }),
    ).result;

    expect(result.status).toBe("budget_exhausted");
    expect(result.usage.modelCalls).toBeLessThanOrEqual(2);
  });

  it("reconstructs run narrative from events without secrets", async () => {
    const { engine, stateReference } = await createWiredHarness({
      understanding: {
        interactionIntent: "question",
        primaryTaskIntent: "question",
        needsClarification: false,
      },
      runTurns: [{ content: "login is exported." }],
    });

    const handle = engine.start(
      startInput("What does src/auth.ts export?", {
        repositoryState: {
          reference: stateReference,
          readiness: "ready",
        },
      }),
    );
    const [result, events] = await Promise.all([
      handle.result,
      collectEvents(handle.events),
    ]);

    expect(result.status).toBe("completed");
    assertSafeEvents(events);

    const stages = events
      .filter((e) => e.type === "stage_started")
      .map((e) => (e.type === "stage_started" ? e.stage : ""));
    expect(stages).toEqual(
      expect.arrayContaining([
        "received",
        "understood",
        "decided",
        "context_ready",
        "model_running",
      ]),
    );

    const terminal = events.find((e) => e.type === "terminal");
    expect(terminal?.type).toBe("terminal");
    if (terminal?.type === "terminal") {
      expect(terminal.result.status).toBe("completed");
      expect(terminal.result.answer).toContain("login");
    }
  });
});
