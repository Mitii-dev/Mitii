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
  it("defaults to runtime-shell engine + eventBus escape + dual-run runtime", () => {
    const llm = new EchoLlmPort();
    const { implementation, engine, eventBusEngine, runtime } =
      composeAgentEngine({
        understandingLlm: llm,
        runLlm: llm,
        enablePlanning: false,
      });
    expect(implementation).toBe("v8");
    expect(typeof eventBusEngine.restore).toBe("function");
    expect(engine).not.toBe(eventBusEngine);
    expect(runtime.stepIds[0]).toBe("1-window-policy");
  });

  it("eventBusEngine.start is sealed (hard-deleted on product surface)", () => {
    const llm = new EchoLlmPort();
    const { engine, eventBusEngine } = composeAgentEngine({
      understandingLlm: llm,
      runLlm: llm,
      enablePlanning: false,
    });
    expect(engine).not.toBe(eventBusEngine);
    expect(() =>
      eventBusEngine.start({
        schemaVersion: 1,
        request: {
          sessionId: "sealed",
          mode: "ask",
          userMessage: "hi",
          workspace: { workspaceId: "ws" },
        },
      }),
    ).toThrow(/event_bus_start_deleted/);
  });

  it("maps legacy implementation to v8", () => {
    const llm = new EchoLlmPort();
    const { implementation, eventBusEngine } = composeAgentEngine({
      understandingLlm: llm,
      runLlm: llm,
      enablePlanning: false,
      implementation: "legacy",
    });
    expect(implementation).toBe("v8");
    expect(typeof eventBusEngine.restore).toBe("function");
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
