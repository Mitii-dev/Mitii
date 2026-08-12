import { describe, expect, it, vi } from "vitest";

import { MEMORY_SCHEMA_VERSION } from "../../../modules/memory";
import { DecisionPolicyPipeline } from "../../../modules/decision-policy";
import { SKILLS_SCHEMA_VERSION } from "../../../modules/skills";
import { AgentEnginePipeline } from "../pipeline/AgentEnginePipeline";
import {
  createDecision,
  createStubDependencies,
  ScriptedLlmPort,
  createCapabilities,
  createUnderstanding,
} from "./fixtures/stubs";

describe("AgentEngine Skills/Memory wiring (Phase 9)", () => {
  it("remains functional when skills and memory ports are omitted", async () => {
    const deps = createStubDependencies({
      decision: createDecision({ route: "direct_answer" }),
      llm: new ScriptedLlmPort(
        [{ content: "Answer without skills." }],
        createCapabilities({ supportsTools: false }),
      ),
    });

    const engine = new AgentEnginePipeline(deps);
    const handle = engine.start({
      schemaVersion: 1,
      request: {
        sessionId: "s1",
        mode: "ask",
        userMessage: "What is 2+2?",
      },
    });

    const result = await handle.result;
    expect(result.status).toBe("completed");
    expect(result.reasonCodes).toContain("skills_skipped");
    expect(result.reasonCodes).toContain("memory_skipped");
  });

  it("selects skills and memory and passes them into prompt construction", async () => {
    const construct = vi.fn(
      createStubDependencies({}).prompt.construct,
    );

    const skills = {
      select: vi.fn(async () => ({
        schemaVersion: SKILLS_SCHEMA_VERSION,
        status: "selected" as const,
        instructions: [
          {
            id: "bugfix-localize",
            title: "Localize",
            content: "Prefer the smallest fix.",
            priority: 120,
            provenance: {
              skillId: "bugfix-localize",
              source: "skills" as const,
              score: 0.9,
            },
          },
        ],
        omissions: [],
        usedTokens: 10,
        budgetTokens: 800,
        warnings: [],
        reasonCodes: ["skills_selected" as const],
        durationMs: 1,
      })),
    };

    const memory = {
      retrieve: vi.fn(async () => ({
        schemaVersion: MEMORY_SCHEMA_VERSION,
        status: "retrieved" as const,
        instructions: [
          {
            id: "m-pnpm",
            title: "Memory (workspace)",
            content: "This workspace uses pnpm.",
            priority: 80,
            provenance: {
              memoryId: "m-pnpm",
              source: "memory" as const,
              scopeKind: "workspace" as const,
              score: 0.8,
              privacy: "shareable" as const,
              createdAt: "2026-07-01T00:00:00.000Z",
            },
          },
        ],
        omissions: [],
        usedTokens: 12,
        budgetTokens: 600,
        warnings: [],
        reasonCodes: ["memory_retrieved" as const],
        durationMs: 1,
      })),
    };

    const deps = createStubDependencies({
      decision: createDecision({ route: "direct_answer" }),
      llm: new ScriptedLlmPort(
        [{ content: "Fixed with skill guidance." }],
        createCapabilities({ supportsTools: false }),
      ),
    });

    const engine = new AgentEnginePipeline({
      ...deps,
      prompt: { construct },
      skills,
      memory,
    });

    const handle = engine.start({
      schemaVersion: 1,
      request: {
        sessionId: "s1",
        mode: "agent",
        userMessage: "Fix the null check with pnpm tooling",
        workspace: { workspaceId: "ws" },
      },
    });

    const events = [];
    for await (const event of handle.events) {
      events.push(event);
    }
    const result = await handle.result;

    expect(result.status).toBe("completed");
    expect(result.reasonCodes).toContain("skills_selected");
    expect(result.reasonCodes).toContain("memory_retrieved");
    expect(skills.select).toHaveBeenCalledOnce();
    expect(memory.retrieve).toHaveBeenCalledOnce();
    expect(construct).toHaveBeenCalledOnce();
    const promptInput = construct.mock.calls[0]![0];
    expect(
      promptInput.instructions?.skills?.map((block: { id: string }) => block.id),
    ).toEqual(["bugfix-localize"]);
    expect(
      promptInput.instructions?.memory?.map((block: { id: string }) => block.id),
    ).toEqual(["m-pnpm"]);
    const skillsReady = events.find(
      (event): event is { type: "skills_ready"; selected?: string[] } =>
        event.type === "skills_ready",
    );
    expect(skillsReady?.selected).toEqual(["bugfix-localize"]);
    expect(events.some((event) => event.type === "memory_ready")).toBe(true);
  });

  it("passes Understanding file targets into skill path evidence before context retrieval", async () => {
    const skills = {
      select: vi.fn(async () => ({
        schemaVersion: SKILLS_SCHEMA_VERSION,
        status: "empty" as const,
        instructions: [],
        omissions: [],
        usedTokens: 0,
        budgetTokens: 800,
        warnings: [],
        reasonCodes: ["no_matching_skills" as const],
        durationMs: 1,
      })),
    };
    const deps = createStubDependencies({
      decision: createDecision({
        route: "execute",
        repositoryContextRequired: false,
      }),
      understanding: createUnderstanding({
        intent: createUnderstanding().intent,
        taskAnalysis: {
          ...createUnderstanding().taskAnalysis,
          targets: [
            { kind: "file", value: "parse.ts", explicit: true },
            { kind: "folder", value: "@src/parsers", explicit: true },
          ],
        },
      }),
      llm: new ScriptedLlmPort(
        [{ content: "ok" }],
        createCapabilities({ supportsTools: false }),
      ),
    });

    const engine = new AgentEnginePipeline({
      ...deps,
      skills,
    });

    const handle = engine.start({
      schemaVersion: 1,
      request: {
        sessionId: "s1",
        mode: "agent",
        userMessage: "Fix the null crash in parse.ts",
      },
    });

    await handle.result;

    expect(skills.select).toHaveBeenCalledOnce();
    expect(skills.select.mock.calls[0]?.[0].evidence.paths).toEqual([
      "parse.ts",
      "src/parsers",
    ]);
  });

  it("narrows the decision grant after repository context discovery", async () => {
    const construct = vi.fn(createStubDependencies({}).prompt.construct);
    const baseDecision = createDecision({
      route: "execute",
      repositoryContextRequired: true,
      toolGrant: {
        maximumWorkspaceEffect: "write",
        allowedTools: ["read_file", "search_files", "apply_patch"],
        allowedEffects: ["workspace_read", "workspace_write"],
        pathScopes: ["."],
        approvalMode: "when_required",
        limits: {
          maxToolCalls: 20,
          maxWallTimeMs: 60_000,
          maxOutputBytes: 256_000,
        },
      },
    });
    const narrow = vi.fn(
      (input: Parameters<DecisionPolicyPipeline["narrow"]>[0]) =>
        new DecisionPolicyPipeline().narrow(input),
    );
    const deps = createStubDependencies({
      decision: baseDecision,
      understanding: createUnderstanding({
        taskAnalysis: {
          ...createUnderstanding().taskAnalysis,
          risk: "low",
        },
      }),
      contextBlocks: [
        {
          id: "ctx_parse",
          relativePath: "src/parser/parse.ts",
          content: "export function parse() {}",
        },
      ],
      llm: new ScriptedLlmPort(
        [{ content: "ok" }],
        createCapabilities({ supportsTools: false }),
      ),
    });

    const engine = new AgentEnginePipeline({
      ...deps,
      decision: {
        decide: deps.decision.decide,
        narrow,
      },
      prompt: { construct },
    });

    const handle = engine.start({
      schemaVersion: 1,
      request: {
        sessionId: "s1",
        mode: "agent",
        userMessage: "Fix the null crash in parse.ts",
      },
      repositoryState: {
        reference: { workspaceId: "ws", stateToken: "state_1" },
        readiness: "ready",
      },
    });

    const events = [];
    for await (const event of handle.events) {
      events.push(event);
    }
    await handle.result;

    expect(narrow).toHaveBeenCalledOnce();
    const promptInput = construct.mock.calls[0]![0];
    expect(promptInput.decision.toolGrant.pathScopes).toEqual(["src/parser"]);
    expect(events.some((event) => event.type === "grant_narrowed")).toBe(true);
  });

  it("skips memory when workspace scope is missing even if memory port exists", async () => {
    const memory = {
      retrieve: vi.fn(async () => {
        throw new Error("should not retrieve");
      }),
    };

    const deps = createStubDependencies({
      decision: createDecision({ route: "direct_answer" }),
      llm: new ScriptedLlmPort(
        [{ content: "ok" }],
        createCapabilities({ supportsTools: false }),
      ),
    });

    const engine = new AgentEnginePipeline({
      ...deps,
      memory,
    });

    const handle = engine.start({
      schemaVersion: 1,
      request: {
        sessionId: "s1",
        mode: "ask",
        userMessage: "hello",
      },
    });

    const result = await handle.result;
    expect(result.status).toBe("completed");
    expect(result.reasonCodes).toContain("memory_skipped");
    expect(memory.retrieve).not.toHaveBeenCalled();
  });
});
