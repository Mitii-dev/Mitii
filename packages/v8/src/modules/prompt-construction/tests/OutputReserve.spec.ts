import { describe, expect, it } from "vitest";

import { PromptConstructionPipeline, estimateTurnOutputHeadroom } from "../index";
import { resolveDynamicOutputTokens } from "../actions";
import { PROMPT_CONSTRUCTION_THRESHOLDS } from "../policy";
import {
  createCapabilities,
  createPromptInput,
} from "./fixtures/promptCases";

describe("prompt construction output reserve", () => {
  it("reserves at least the minimum output floor before dynamic scaling", () => {
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
    expect(result.request.maximumOutputTokens).toBeGreaterThanOrEqual(
      result.budget.outputReservedTokens,
    );
  });

  it("uses configured max output as a reserve baseline, not the per-turn ceiling", () => {
    const result = new PromptConstructionPipeline().construct(
      createPromptInput({
        capabilities: createCapabilities({
          contextWindowTokens: 32_768,
          maximumOutputTokens: 2_048,
        }),
      }),
    );

    expect(result.budget.outputReservedTokens).toBeLessThanOrEqual(2_048);
    expect(result.request.maximumOutputTokens).toBeGreaterThan(2_048);
    expect(result.reasonCodes).toContain("dynamic_output_expanded");
  });

  it("scales output from the remaining per-turn context on large windows", () => {
    const result = new PromptConstructionPipeline().construct(
      createPromptInput({
        capabilities: createCapabilities({
          contextWindowTokens: 252_000,
          maximumOutputTokens: 64_000,
        }),
      }),
    );

    expect(result.budget.outputReservedTokens).toBe(64_000);
    expect(result.request.maximumOutputTokens).toBeGreaterThan(64_000);
    expect(result.reasonCodes).toContain("dynamic_output_expanded");
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
    expect(result.reasonCodes).toContain("dynamic_output_expanded");
  });

  it("scales beyond a 5k configured output limit when the turn has free window", () => {
    const result = new PromptConstructionPipeline().construct(
      createPromptInput({
        capabilities: createCapabilities({
          contextWindowTokens: 30_000,
          maximumOutputTokens: 5_000,
        }),
      }),
    );

    expect(result.budget.outputReservedTokens).toBe(5_000);
    expect(result.request.maximumOutputTokens).toBeGreaterThan(5_000);
    expect(result.reasonCodes).toContain("dynamic_output_expanded");
  });

  it("uses 95 percent of the remaining context window for output each turn", () => {
    const result = resolveDynamicOutputTokens({
      contextWindowTokens: 30_000,
      configuredOutputTokens: 5_000,
      outputReservedTokens: 5_000,
      usedInputTokens: 12_000,
    });

    expect(result.availableOutputTokens).toBe(18_000);
    expect(result.dynamicOutputRatio).toBe(0.95);
    expect(result.maximumOutputTokens).toBe(17_100);
    expect(result.reasonCodes).toContain("dynamic_output_expanded");
  });

  it("keeps output inside the remaining context when input exceeds reserve budget", () => {
    const result = resolveDynamicOutputTokens({
      contextWindowTokens: 30_000,
      configuredOutputTokens: 20_000,
      outputReservedTokens: 10_000,
      usedInputTokens: 25_500,
      dynamicOutputRatio: 0.95,
    });

    expect(result.maximumOutputTokens).toBe(4_275);
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
