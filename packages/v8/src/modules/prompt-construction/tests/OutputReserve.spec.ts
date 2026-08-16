import { describe, expect, it } from "vitest";

import { PromptConstructionPipeline, estimateTurnOutputHeadroom } from "../index";
import { resolveDynamicOutputTokens } from "../actions";
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

  it("does not apply a fixed output ceiling to large context windows", () => {
    const result = new PromptConstructionPipeline().construct(
      createPromptInput({
        capabilities: createCapabilities({
          contextWindowTokens: 252_000,
          maximumOutputTokens: 64_000,
        }),
      }),
    );

    expect(result.budget.outputReservedTokens).toBe(64_000);
    expect(result.request.maximumOutputTokens).toBe(64_000);
  });

  it("expands the final output limit into unused input window", () => {
    const result = new PromptConstructionPipeline().construct(
      createPromptInput({
        capabilities: createCapabilities({
          contextWindowTokens: 30_000,
          maximumOutputTokens: 20_000,
        }),
        outputReserveTokens: 5_000,
      }),
    );

    expect(result.budget.outputReservedTokens).toBe(5_000);
    expect(result.request.maximumOutputTokens).toBeGreaterThan(5_000);
    expect(result.request.maximumOutputTokens).toBe(20_000);
    expect(result.reasonCodes).toContain("dynamic_output_expanded");
    expect(result.reasonCodes).toContain("dynamic_output_capped_by_provider");
  });

  it("respects provider max output when unused context is larger", () => {
    const result = new PromptConstructionPipeline().construct(
      createPromptInput({
        capabilities: createCapabilities({
          contextWindowTokens: 30_000,
          maximumOutputTokens: 5_000,
        }),
      }),
    );

    expect(result.request.maximumOutputTokens).toBe(5_000);
    expect(result.budget.outputReservedTokens).toBe(5_000);
    expect(result.reasonCodes).toContain("dynamic_output_capped_by_provider");
  });

  it("keeps output inside the remaining context when input exceeds reserve budget", () => {
    const result = resolveDynamicOutputTokens({
      contextWindowTokens: 30_000,
      providerMaximumOutputTokens: 20_000,
      outputReservedTokens: 10_000,
      usedInputTokens: 25_500,
      safetyMarginTokens: 250,
    });

    expect(result.maximumOutputTokens).toBe(4_250);
    expect(result.availableOutputTokens).toBe(4_500);
    expect(result.reasonCodes).toContain("dynamic_output_limited_by_context");
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
