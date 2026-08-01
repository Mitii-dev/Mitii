import { describe, expect, it } from "vitest";

import { PromptConstructionPipeline, estimateTurnOutputHeadroom } from "../index";
import { PROMPT_CONSTRUCTION_THRESHOLDS } from "../policy";
import {
  createCapabilities,
  createPromptInput,
} from "./fixtures/promptCases";

describe("prompt construction output reserve", () => {
  it("reserves at least the minimum output floor when the window allows", () => {
    const result = new PromptConstructionPipeline().construct(
      createPromptInput({
        capabilities: createCapabilities({
          contextWindowTokens: 32_768,
          maximumOutputTokens: 16_384,
        }),
      }),
    );

    expect(result.budget.outputReservedTokens).toBeGreaterThanOrEqual(
      PROMPT_CONSTRUCTION_THRESHOLDS.minimumOutputReserveTokens,
    );
    expect(result.request.maximumOutputTokens).toBe(
      result.budget.outputReservedTokens,
    );
  });

  it("caps output reserve by provider maximumOutputTokens", () => {
    const result = new PromptConstructionPipeline().construct(
      createPromptInput({
        capabilities: createCapabilities({
          contextWindowTokens: 32_768,
          maximumOutputTokens: 2_048,
        }),
      }),
    );

    expect(result.budget.outputReservedTokens).toBeLessThanOrEqual(2_048);
    expect(result.request.maximumOutputTokens).toBeLessThanOrEqual(2_048);
  });
});

describe("estimateTurnOutputHeadroom", () => {
  it("flags payloads that exceed soft headroom", () => {
    const ok = estimateTurnOutputHeadroom({
      maximumOutputTokens: 8_192,
      estimatedPayloadCharacters: 1_000,
    });
    expect(ok.withinHeadroom).toBe(true);

    const over = estimateTurnOutputHeadroom({
      maximumOutputTokens: 4_096,
      estimatedPayloadCharacters: 50_000,
    });
    expect(over.withinHeadroom).toBe(false);
    expect(over.safePayloadCharacters).toBeGreaterThan(0);
  });
});
