import { describe, expect, it } from "vitest";

import {
  composeAgentEngine,
  compareEngineImplementations,
  parseV8EngineImplementation,
} from "../adapters";
import { AgentEnginePipeline } from "../../agent-engine/pipeline/AgentEnginePipeline";
import { V8EnginePipeline } from "../pipeline/V8EnginePipeline";
import {
  createDecision,
  createStubDependencies,
  ScriptedLlmPort,
  createCapabilities,
} from "../../agent-engine/tests/fixtures/stubs";
import { EchoLlmPort } from "../../../modules/model-gateway";

describe("composeAgentEngine", () => {
  it("defaults to v8 V8EnginePipeline (Phase 5)", () => {
    const llm = new EchoLlmPort();
    const { implementation, engine } = composeAgentEngine({
      understandingLlm: llm,
      runLlm: llm,
      enablePlanning: false,
    });
    expect(implementation).toBe("v8");
    expect(engine).toBeInstanceOf(V8EnginePipeline);
  });

  it("selects AgentEnginePipeline when implementation is legacy", () => {
    const llm = new EchoLlmPort();
    const { implementation, engine } = composeAgentEngine({
      understandingLlm: llm,
      runLlm: llm,
      enablePlanning: false,
      implementation: "legacy",
    });
    expect(implementation).toBe("legacy");
    expect(engine).toBeInstanceOf(AgentEnginePipeline);
  });

  it("parseV8EngineImplementation falls back to promoted default", () => {
    expect(parseV8EngineImplementation("v8")).toBe("v8");
    expect(parseV8EngineImplementation("legacy")).toBe("legacy");
    expect(parseV8EngineImplementation("nope")).toBe("v8");
    expect(parseV8EngineImplementation(undefined)).toBe("v8");
  });
});

describe("compareEngineImplementations", () => {
  it("runs the same ask start on legacy and v8", async () => {
    const compared = await compareEngineImplementations({
      createOptions: () => ({
        understandingLlm: new ScriptedLlmPort(
          [
            {
              content: JSON.stringify({
                interactionIntent: "question",
                primaryTaskIntent: "question",
                secondaryTaskIntents: [],
                confidence: 0.95,
                alternatives: [],
                needsClarification: false,
                reason: "compare",
              }),
            },
          ],
          createCapabilities({
            supportsTools: false,
            supportsStructuredOutput: true,
          }),
        ),
        runLlm: new ScriptedLlmPort(
          [{ content: "Four." }],
          createCapabilities({ supportsTools: false }),
        ),
        enablePlanning: false,
        // Force a deterministic decision path via stub deps is hard with compose;
        // both sides should at least finish without throwing.
      }),
      startInput: {
        schemaVersion: 1,
        request: {
          sessionId: "sess_compare",
          mode: "ask",
          userMessage: "What is 2+2?",
          workspace: { workspaceId: "ws_compare" },
        },
      },
    });

    expect(compared.legacy.implementation).toBe("legacy");
    expect(compared.v8.implementation).toBe("v8");
    expect(compared.legacy.result.runId).toBeTruthy();
    expect(compared.v8.result.runId).toBeTruthy();
  });
});

describe("composeAgentEngine with stub decision (direct)", () => {
  it("legacy and v8 both complete a scripted ask via pipeline constructors", async () => {
    const startInput = {
      schemaVersion: 1 as const,
      request: {
        sessionId: "sess_1",
        mode: "ask" as const,
        userMessage: "What is 2+2?",
        workspace: { workspaceId: "ws_1" },
      },
    };
    const legacy = new AgentEnginePipeline(
      createStubDependencies({
        decision: createDecision({ route: "direct_answer" }),
        llm: new ScriptedLlmPort(
          [{ content: "Four." }],
          createCapabilities({ supportsTools: false }),
        ),
      }),
    );
    const v8 = new V8EnginePipeline(
      createStubDependencies({
        decision: createDecision({ route: "direct_answer" }),
        llm: new ScriptedLlmPort(
          [{ content: "Four." }],
          createCapabilities({ supportsTools: false }),
        ),
      }),
    );
    const [legacyResult, v8Result] = await Promise.all([
      legacy.start(startInput).result,
      v8.start(startInput).result,
    ]);
    expect(legacyResult.status).toBe("completed");
    expect(v8Result.status).toBe("completed");
    expect(legacyResult.answer).toBe("Four.");
    expect(v8Result.answer).toBe("Four.");
  });
});
