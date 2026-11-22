import { describe, expect, it } from "vitest";

import type {
  LlmPort,
  ModelCapabilities,
  ModelEvent,
} from "../../../model-gateway";
import {
  INTENT_CONSTANTS,
  REQUEST_UNDERSTANDING_IDS,
  RequestUnderstandingPipeline,
  extractPrimaryUserMessage,
  isContinuationTurnKind,
  parseClarificationOptionId,
  requestUnderstandingPipelineInputSchema,
  requestUnderstandingResultSchema,
} from "../../index";

const CAPABILITIES: ModelCapabilities = {
  modelId: "test/understanding-contract",
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

function staticLlm(response: Record<string, unknown>): LlmPort {
  return {
    id: "static-understanding-contract-llm",
    capabilities: CAPABILITIES,
    async *complete(): AsyncIterable<ModelEvent> {
      yield { type: "content_delta", content: JSON.stringify(response) };
      yield { type: "completed", finishReason: "stop" };
    },
  };
}

const BUGFIX_BALLOT = {
  interactionIntent: "act",
  primaryTaskIntent: "bugfix",
  secondaryTaskIntents: [],
  confidence: 0.94,
  alternatives: [],
  needsClarification: false,
  reason: "Contract classification.",
};

function envelope(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    requestId: "request-contract",
    sessionId: "session-contract",
    mode: "agent",
    origin: "user",
    message: "Fix the authentication bug in src/auth/service.ts",
    referencedArtifacts: [],
    createdAt: "2026-07-25T12:00:00.000Z",
    ...overrides,
  };
}

describe("RequestUnderstanding contract: input", () => {
  it("accepts a valid envelope", () => {
    expect(
      requestUnderstandingPipelineInputSchema.safeParse(envelope()).success,
    ).toBe(true);
  });

  it("rejects invalid modes and unknown schema versions at the boundary", () => {
    expect(
      requestUnderstandingPipelineInputSchema.safeParse(
        envelope({ mode: "turbo" }),
      ).success,
    ).toBe(false);
    expect(
      requestUnderstandingPipelineInputSchema.safeParse(
        envelope({ schemaVersion: 7 }),
      ).success,
    ).toBe(false);
  });

  it("rejects blank messages when understanding runs", async () => {
    const pipeline = new RequestUnderstandingPipeline(staticLlm(BUGFIX_BALLOT));
    await expect(
      pipeline.understand(envelope({ message: "   " }) as never),
    ).rejects.toThrow();
  });
});

describe("RequestUnderstanding contract: output", () => {
  it("returns a schema-valid result with intent, analysis and stable shape", async () => {
    const pipeline = new RequestUnderstandingPipeline(staticLlm(BUGFIX_BALLOT));
    const result = await pipeline.understand(
      requestUnderstandingPipelineInputSchema.parse(envelope()),
    );
    expect(requestUnderstandingResultSchema.parse(result)).toEqual(result);
    expect(Object.keys(result).sort()).toEqual(
      expect.arrayContaining(["intent", "taskAnalysis"]),
    );
    expect(result.intent.status).toBe("accepted");
    expect(result.intent.classification.primaryTaskIntent).toBe("bugfix");
    expect(INTENT_CONSTANTS.TASK_INTENTS).toContain(
      result.intent.classification.primaryTaskIntent,
    );
    expect(result.taskAnalysis.targets.length).toBeGreaterThan(0);
  });

  it("surfaces clarification through intent flags instead of guessing", async () => {
    const pipeline = new RequestUnderstandingPipeline(
      staticLlm({
        ...BUGFIX_BALLOT,
        confidence: 0.3,
        needsClarification: true,
        reason: "Ambiguous ask.",
      }),
    );
    const result = await pipeline.understand(
      requestUnderstandingPipelineInputSchema.parse(
        envelope({ message: "do it" }),
      ),
    );
    expect(
      result.intent.recommendsClarification ||
        result.intent.classification.needsClarification ||
        result.intent.status === "clarification_required",
    ).toBe(true);
  });

  it("exposes a stable pipeline id", () => {
    expect(REQUEST_UNDERSTANDING_IDS.PIPELINE).toBe(
      "request-understanding-pipeline",
    );
  });
});

describe("RequestUnderstanding contract: public helpers", () => {
  it("returns the primary ask from host-wrapped messages", () => {
    const wrapped =
      "<<<MITII_HOST_CONTEXT>>>\nopen file: a.ts\n<<<MITII_USER_MESSAGE>>>\nFix the bug";
    expect(extractPrimaryUserMessage(wrapped)).toBe("Fix the bug");
    expect(extractPrimaryUserMessage("plain ask")).toBe("plain ask");
  });

  it("parses clarification option ids into a fact patch", () => {
    expect(parseClarificationOptionId("target:src/a.ts").targetPath).toBe(
      "src/a.ts",
    );
    expect(parseClarificationOptionId("intent:bugfix").primaryTaskIntent).toBe(
      "bugfix",
    );
  });

  it("treats only continuation turn kinds as continuations", () => {
    expect(isContinuationTurnKind(undefined)).toBe(false);
    expect(isContinuationTurnKind("new")).toBe(false);
    for (const kind of ["continue", "steer", "follow_up", "recover"] as const) {
      expect(isContinuationTurnKind(kind)).toBe(true);
    }
  });
});
