import { describe, expect, it } from "vitest";

import {
  EchoLlmPort,
  MODEL_GATEWAY_STAGES,
  ModelGatewayPipeline,
  type ModuleLoggerPort,
} from "../../index";

describe("ModelGatewayPipeline", () => {
  it("resolves capabilities with stage logging", () => {
    const stages: string[] = [];
    const log: ModuleLoggerPort = {
      stage(event) {
        stages.push(event.stage);
      },
    };
    const capabilities = new ModelGatewayPipeline({ log }).resolveCapabilities({
      modelId: "provider/model",
      contextWindowTokens: 100_000,
      supportsTools: true,
    });
    expect(capabilities.maximumOutputTokens).toBe(25_000);
    expect(stages).toEqual([MODEL_GATEWAY_STAGES.resolveCapabilities]);
  });

  it("streams complete through an injected port and logs terminal stage", async () => {
    const stages: string[] = [];
    const log: ModuleLoggerPort = {
      stage(event) {
        stages.push(event.stage);
      },
    };
    const port = new EchoLlmPort({
      modelId: "echo",
      contextWindowTokens: 8_192,
    });
    const events = [];
    for await (const event of new ModelGatewayPipeline({ log }).complete(
      port,
      {
        messages: [{ role: "user", content: "hello" }],
      },
    )) {
      events.push(event);
    }
    expect(events.some((e) => e.type === "completed")).toBe(true);
    expect(stages).toEqual([MODEL_GATEWAY_STAGES.complete]);
  });
});
