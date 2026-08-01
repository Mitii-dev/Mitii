import assert from "node:assert/strict";
import test from "node:test";

import type {
  LlmPort,
  ModelCapabilities,
  ModelEvent,
  ModelRequest,
} from "../../model-gateway";
import {
  requestUnderstandingPipelineInputSchema,
  requestUnderstandingResultSchema,
  RequestUnderstandingPipeline,
} from "../index";
import type { RequestUnderstandingPipelineInput } from "../contracts";

class StaticLlmPort implements LlmPort {
  public readonly id = "static-understanding-llm";

  public readonly capabilities: ModelCapabilities = {
    modelId: "test/understanding",
    contextWindowTokens: 8_192,
    maximumOutputTokens: 1_000,
    supportsStreaming: true,
    supportsTools: false,
    supportsParallelToolCalls: false,
    supportsStructuredOutput: true,
    supportsVision: false,
    supportsReasoning: false,
    supportsPromptCaching: false,
    supportsEmbeddings: false,
  };

  constructor(
    private readonly response: Record<string, unknown>,
  ) {}

  public async *complete(
    _request: ModelRequest,
  ): AsyncIterable<ModelEvent> {
    yield {
      type: "content_delta",
      content: JSON.stringify(this.response),
    };
    yield {
      type: "completed",
      finishReason: "stop",
    };
  }
}

const envelope = (
  overrides: Partial<RequestUnderstandingPipelineInput> = {},
): RequestUnderstandingPipelineInput =>
  requestUnderstandingPipelineInputSchema.parse({
    schemaVersion: 1,
    requestId: "request-1",
    sessionId: "session-1",
    mode: "agent",
    origin: "user",
    message: "Fix the authentication bug in src/auth/service.ts",
    referencedArtifacts: [],
    createdAt: "2026-07-25T12:00:00.000Z",
    ...overrides,
  });

test("request understanding pipeline returns validated intent and task analysis", async () => {
  const pipeline = new RequestUnderstandingPipeline(
    new StaticLlmPort({
      interactionIntent: "act",
      primaryTaskIntent: "bugfix",
      secondaryTaskIntents: [],
      confidence: 0.94,
      alternatives: [],
      needsClarification: false,
      reason: "Test classification.",
    }),
  );

  const result = await pipeline.understand(envelope());

  assert.doesNotThrow(() =>
    requestUnderstandingResultSchema.parse(result),
  );
  assert.equal(result.intent.classification.primaryTaskIntent, "bugfix");
  assert.equal(result.intent.classification.interactionIntent, "act");
  assert.ok(result.taskAnalysis.targets.length >= 1);
  assert.equal(result.taskAnalysis.recommendsVerification, true);
});

test("request understanding pipeline maps envelope artifacts into task analysis", async () => {
  const pipeline = new RequestUnderstandingPipeline(
    new StaticLlmPort({
      interactionIntent: "act",
      primaryTaskIntent: "bugfix",
      secondaryTaskIntents: [],
      confidence: 0.9,
      alternatives: [],
      needsClarification: false,
    }),
  );

  const result = await pipeline.understand(
    envelope({
      message: "Fix the selected handler.",
      referencedArtifacts: [
        {
          name: "handler.go",
          path: "internal/auth/handler.go",
          kind: "selection",
        },
      ],
    }),
  );

  assert.ok(
    result.taskAnalysis.targets.some(
      (target) =>
        target.kind === "file" &&
        target.value === "internal/auth/handler.go" &&
        target.explicit === false,
    ),
  );
  assert.equal(result.taskAnalysis.recommendsRepositoryDiscovery, false);
});

test("request understanding pipeline rejects empty envelopes", async () => {
  const pipeline = new RequestUnderstandingPipeline(
    new StaticLlmPort({
      interactionIntent: "question",
      primaryTaskIntent: "question",
      secondaryTaskIntents: [],
      confidence: 0.8,
      alternatives: [],
      needsClarification: false,
    }),
  );

  await assert.rejects(
    () =>
      pipeline.understand({
        schemaVersion: 1,
        requestId: "request-1",
        sessionId: "session-1",
        mode: "ask",
        origin: "user",
        message: "   ",
        referencedArtifacts: [],
        createdAt: "2026-07-25T12:00:00.000Z",
      }),
  );
});
