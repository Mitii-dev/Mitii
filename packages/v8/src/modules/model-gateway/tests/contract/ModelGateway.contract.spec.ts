import { describe, expect, it } from "vitest";

import {
  ModelCapabilityResolver,
  modelErrorSchema,
  modelMessageSchema,
  modelRequestSchema,
} from "../../index";

describe("Model Gateway contract", () => {
  it("capability resolver produces a validated provider-neutral contract", () => {
    const result = new ModelCapabilityResolver().resolve({
      modelId: "provider/model",
      contextWindowTokens: 128_000,
      supportsTools: true,
      supportsParallelToolCalls: true,
      supportsStructuredOutput: true,
    });

    expect(result.maximumOutputTokens).toBe(32_000);
    expect(result.supportsParallelToolCalls).toBe(true);
  });

  it("capability resolver derives default output from the context window", () => {
    const result = new ModelCapabilityResolver().resolve({
      modelId: "provider/large-context",
      contextWindowTokens: 252_000,
    });

    expect(result.maximumOutputTokens).toBe(63_000);
  });

  it("tool results and structured model errors have explicit contracts", () => {
    expect(
      modelMessageSchema.safeParse({
        role: "tool",
        content: "done",
      }).success,
    ).toBe(false);

    expect(
      modelMessageSchema.safeParse({
        role: "tool",
        content: "done",
        toolCallId: "call-1",
      }).success,
    ).toBe(true);

    expect(
      modelErrorSchema.parse({
        code: "rate_limited",
        message: "Try later.",
        retryable: true,
        retryAfterMs: 500,
      }),
    ).toEqual({
      code: "rate_limited",
      message: "Try later.",
      retryable: true,
      retryAfterMs: 500,
    });
  });

  it("tool choice cannot request tools without tool definitions", () => {
    expect(
      modelRequestSchema.safeParse({
        messages: [
          {
            role: "user",
            content: "Run a tool.",
          },
        ],
        toolChoice: "required",
      }).success,
    ).toBe(false);
  });
});
