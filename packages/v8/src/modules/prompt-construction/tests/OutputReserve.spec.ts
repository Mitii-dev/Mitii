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

  it("treats a real host max output as the per-turn ceiling", () => {
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
    expect(result.reasonCodes).not.toContain("dynamic_output_expanded");
  });

  it("does not expand output past a real host ceiling on large windows", () => {
    const result = new PromptConstructionPipeline().construct(
      createPromptInput({
        capabilities: createCapabilities({
          contextWindowTokens: 252_000,
          maximumOutputTokens: 64_000,
        }),
      }),
    );

    expect(result.budget.outputReservedTokens).toBe(64_000);
    expect(result.request.maximumOutputTokens).toBeLessThanOrEqual(64_000);
    expect(result.reasonCodes).not.toContain("dynamic_output_expanded");
  });

  it("expands past the planning reserve into leftover context", () => {
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
    expect(result.request.maximumOutputTokens).toBeLessThanOrEqual(20_000);
    expect(result.reasonCodes).toContain("dynamic_output_expanded");
  });

  it("ignores the legacy 5k default and writes into leftover context", () => {
    const result = new PromptConstructionPipeline().construct(
      createPromptInput({
        capabilities: createCapabilities({
          contextWindowTokens: 30_000,
          maximumOutputTokens: 5_000,
        }),
      }),
    );

    expect(result.request.maximumOutputTokens).toBeGreaterThan(5_000);
    expect(result.reasonCodes).toContain("dynamic_output_expanded");
  });

  it("lets a 10k-free window write about 10k tokens", () => {
    const result = resolveDynamicOutputTokens({
      contextWindowTokens: 30_000,
      configuredOutputTokens: 10_240,
      outputReservedTokens: 10_240,
      usedInputTokens: 20_000,
    });

    expect(result.availableOutputTokens).toBe(10_000);
    expect(result.dynamicOutputRatio).toBe(0.95);
    expect(result.maximumOutputTokens).toBe(9_500);
    expect(result.reasonCodes).toContain("dynamic_output_limited_by_context");
  });

  it("expands a derived reserve to 95 percent leftover", () => {
    const result = resolveDynamicOutputTokens({
      contextWindowTokens: 30_000,
      configuredOutputTokens: 10_240,
      outputReservedTokens: 10_240,
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
