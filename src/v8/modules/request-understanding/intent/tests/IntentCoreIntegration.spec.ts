import assert from "node:assert/strict";
import test from "node:test";

import type {
  LlmPort,
  ModelCapabilities,
  ModelRequest,
  ModelResponseDelta,
} from "../../../model-gateway";

import {
  IntentRouter,
} from "../IntentRouter";

class StaticLlmPort
  implements LlmPort {
  public readonly id =
    "static-intent-llm";

  public readonly capabilities:
    ModelCapabilities = {
    modelId:
      "test/intent",
    contextWindowTokens:
      8_192,
    maximumOutputTokens:
      1_000,
    supportsStreaming:
      true,
    supportsTools:
      false,
    supportsParallelToolCalls:
      false,
    supportsStructuredOutput:
      true,
    supportsVision:
      false,
    supportsReasoning:
      false,
    supportsPromptCaching:
      false,
    supportsEmbeddings:
      false,
  };

  public lastRequest:
    ModelRequest |
    undefined;

  constructor(
    private readonly response:
      Record<
        string,
        unknown
      >,
  ) {}

  public async *complete(
    request: ModelRequest,
  ): AsyncIterable<
    ModelResponseDelta
  > {
    this.lastRequest =
      request;

    yield {
      content:
        JSON.stringify(
          this.response,
        ),
      done:
        true,
      finishReason:
        "stop",
    };
  }
}

const classification = (
  interactionIntent:
    "question" |
    "plan" |
    "act",
  primaryTaskIntent:
    "question" |
    "feature",
) => ({
  interactionIntent,
  primaryTaskIntent,
  secondaryTaskIntents:
    [],
  confidence:
    0.95,
  alternatives:
    [],
  needsClarification:
    false,
  reason:
    "Test classification.",
});

test(
  "agent mode permits actions without forcing questions into act",
  async () => {
    const provider =
      new StaticLlmPort(
        classification(
          "question",
          "question",
        ),
      );
    const router =
      new IntentRouter(
        provider,
      );

    const result =
      await router.classify({
        mode:
          "agent",
        userMessage:
          "What is dependency injection?",
      });

    assert.equal(
      result
        .classification
        .interactionIntent,
      "question",
    );
    assert.equal(
      provider
        .lastRequest
        ?.maximumOutputTokens,
      1_000,
    );
    assert.equal(
      provider
        .lastRequest
        ?.toolChoice,
      "none",
    );
  },
);

test(
  "ask mode constrains an implementation request to read-only interaction",
  async () => {
    const provider =
      new StaticLlmPort(
        classification(
          "act",
          "feature",
        ),
      );
    const router =
      new IntentRouter(
        provider,
      );

    const result =
      await router.classify({
        mode:
          "ask",
        userMessage:
          "Implement a new endpoint feature.",
      });

    assert.equal(
      result
        .classification
        .primaryTaskIntent,
      "feature",
    );
    assert.equal(
      result
        .classification
        .interactionIntent,
      "question",
    );
  },
);
