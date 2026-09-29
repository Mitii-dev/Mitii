import { describe, expect, it } from "vitest";

import {
  composeAgentEngine,
  parseV8EngineImplementation,
} from "../adapters";
import { V8EnginePipeline } from "../pipeline/V8EnginePipeline";
import {
  createDecision,
  createStubDependencies,
  ScriptedLlmPort,
  createCapabilities,
} from "../tests/fixtures/stubs";
import { EchoLlmPort } from "../../../modules/model-gateway";

describe("composeAgentEngine", () => {
  it("defaults to v8 V8EnginePipeline", () => {
    const llm = new EchoLlmPort();
    const { implementation, engine } = composeAgentEngine({
      understandingLlm: llm,
      runLlm: llm,
      enablePlanning: false,
    });
    expect(implementation).toBe("v8");
    expect(engine).toBeInstanceOf(V8EnginePipeline);
  });

  it("maps legacy implementation to v8 (Phase 10)", () => {
    const llm = new EchoLlmPort();
    const { implementation, engine } = composeAgentEngine({
      understandingLlm: llm,
      runLlm: llm,
      enablePlanning: false,
      implementation: "legacy",
    });
    expect(implementation).toBe("v8");
    expect(engine).toBeInstanceOf(V8EnginePipeline);
  });

  it("parseV8EngineImplementation falls back to promoted default", () => {
    expect(parseV8EngineImplementation("v8")).toBe("v8");
    expect(parseV8EngineImplementation("legacy")).toBe("v8");
    expect(parseV8EngineImplementation("nope")).toBe("v8");
    expect(parseV8EngineImplementation(undefined)).toBe("v8");
  });
});

describe("composeAgentEngine with stub decision (direct)", () => {
  it("v8 completes a scripted ask via pipeline constructor", async () => {
    const startInput = {
      schemaVersion: 1 as const,
      request: {
        sessionId: "sess_1",
        mode: "ask" as const,
        userMessage: "What is 2+2?",
        workspace: { workspaceId: "ws_1" },
      },
    };
    const v8 = new V8EnginePipeline(
      createStubDependencies({
        decision: createDecision({ route: "direct_answer" }),
        llm: new ScriptedLlmPort(
          [{ content: "Four." }],
          createCapabilities({ supportsTools: false }),
        ),
      }),
    );
    const result = await v8.start(startInput).result;
    expect(result.status).toBe("completed");
    expect(result.answer).toContain("Four");
  });
});
