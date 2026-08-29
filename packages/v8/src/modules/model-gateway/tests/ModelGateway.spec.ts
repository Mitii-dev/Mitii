import assert from "node:assert/strict";
import test from "node:test";

import {
  ModelCapabilityResolver,
  modelErrorSchema,
  modelMessageSchema,
  modelRequestSchema,
} from "../index";

test(
  "capability resolver produces a validated provider-neutral contract",
  () => {
    const result =
      new ModelCapabilityResolver()
        .resolve({
          modelId:
            "provider/model",
          contextWindowTokens:
            128_000,
          supportsTools:
            true,
          supportsParallelToolCalls:
            true,
          supportsStructuredOutput:
            true,
        });

    assert.equal(
      result
        .maximumOutputTokens,
      32_000,
    );
    assert.equal(
      result
        .supportsParallelToolCalls,
      true,
    );
  },
);

test(
  "capability resolver derives default output from the context window",
  () => {
    const result = new ModelCapabilityResolver()
      .resolve({
        modelId:
          "provider/large-context",
        contextWindowTokens:
          252_000,
      });

    assert.equal(
      result.maximumOutputTokens,
      63_000,
    );
  },
);

test(
  "tool results and structured model errors have explicit contracts",
  () => {
    assert.equal(
      modelMessageSchema
        .safeParse({
          role:
            "tool",
          content:
            "done",
        })
        .success,
      false,
    );

    assert.equal(
      modelMessageSchema
        .safeParse({
          role:
            "tool",
          content:
            "done",
          toolCallId:
            "call-1",
        })
        .success,
      true,
    );

    assert.deepEqual(
      modelErrorSchema
        .parse({
          code:
            "rate_limited",
          message:
            "Try later.",
          retryable:
            true,
          retryAfterMs:
            500,
        }),
      {
        code:
          "rate_limited",
        message:
          "Try later.",
        retryable:
          true,
        retryAfterMs:
          500,
      },
    );
  },
);

test(
  "tool choice cannot request tools without tool definitions",
  () => {
    assert.equal(
      modelRequestSchema
        .safeParse({
          messages: [
            {
              role:
                "user",
              content:
                "Run a tool.",
            },
          ],
          toolChoice:
            "required",
        })
        .success,
      false,
    );
  },
);
