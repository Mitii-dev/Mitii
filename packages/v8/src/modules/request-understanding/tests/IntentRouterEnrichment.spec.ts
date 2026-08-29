import { describe, expect, it, vi } from "vitest";

import type {
  LlmPort,
  ModelCapabilities,
  ModelEvent,
  ModelRequest,
} from "../../model-gateway";
import { IntentRouter } from "../intent/IntentRouter";
import { RuleIntentClassifier } from "../intent/classifiers";
import { TaskAnalyzer } from "../task-analyzer/TaskAnalyzer";
import type { SuperIntentResult } from "../intent/types";

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

  public callCount = 0;
  public lastRequest: ModelRequest | undefined;

  constructor(private readonly response: Record<string, unknown>) {}

  public async *complete(request: ModelRequest): AsyncIterable<ModelEvent> {
    this.callCount += 1;
    this.lastRequest = request;
    yield {
      type: "content_delta",
      content: JSON.stringify(this.response),
    };
    yield { type: "completed", finishReason: "stop" };
  }
}

function baseIntent(
  overrides: Partial<SuperIntentResult["classification"]> = {},
): SuperIntentResult {
  return {
    status: "accepted",
    classification: {
      interactionIntent: "act",
      primaryTaskIntent: "bugfix",
      secondaryTaskIntents: [],
      confidence: 0.92,
      alternatives: [],
      needsClarification: false,
      reason: "test",
      ...overrides,
    },
    scores: [
      {
        intent: "bugfix",
        score: 0.92,
        ruleScore: 0,
        llmScore: 0.92,
      },
    ],
    confidenceMargin: 0.5,
    recommendsClarification: false,
    diagnostics: {
      llmPrimaryIntent: "bugfix",
      llmInteractionIntent: "act",
      taskAgreement: false,
      interactionAgreement: true,
      interactionConflict: false,
      agreementBonusApplied: 0,
      disagreementPenaltyApplied: 0,
      minimumConfidence: 0.55,
      minimumMargin: 0.12,
    },
  };
}

describe("IntentRouter enrichment", () => {
  it("recognizes API design asks as feature actions", () => {
    const classifier = new RuleIntentClassifier();

    const result = classifier.classifyMessage(
      [
        "I need an api to get the analytic results based on the user query",
        "the analytics will be based on the bill and items",
        "I need to design an api that accepts the user message and gets results from db",
      ].join("\n"),
    );

    expect(result?.primaryTaskIntent).toBe("feature");
    expect(result?.interactionIntent).toBe("act");
  });

  it("skips the LLM when an explicit slash intent matches", async () => {
    const provider = new StaticLlmPort({
      interactionIntent: "act",
      primaryTaskIntent: "feature",
      secondaryTaskIntents: [],
      confidence: 0.99,
      alternatives: [],
      needsClarification: false,
    });
    const completeSpy = vi.spyOn(provider, "complete");
    const router = new IntentRouter(provider);

    const result = await router.classify({
      mode: "agent",
      userMessage: "/bugfix null pointer in parse.ts",
    });

    expect(completeSpy).not.toHaveBeenCalled();
    expect(provider.callCount).toBe(0);
    expect(result.classification.primaryTaskIntent).toBe("bugfix");
    expect(result.diagnostics.ruleSource).toBe("explicit_rule");
    expect(result.classification.confidence).toBe(1);
  });

  it("preserves optional taskHints from the LLM classification", async () => {
    const provider = new StaticLlmPort({
      interactionIntent: "act",
      primaryTaskIntent: "bugfix",
      secondaryTaskIntents: [],
      confidence: 0.91,
      alternatives: [],
      needsClarification: false,
      reason: "Fix a defect.",
      taskHints: {
        targets: [
          { kind: "file", value: "src/hidden/util.ts", explicit: true },
        ],
        constraints: ["Do not change public APIs"],
        requestedOutcomes: ["Utility edge case passes"],
        clarity: "partially_clear",
        recommendedSkillTags: ["localize", "null-safety"],
      },
    });
    const router = new IntentRouter(provider);

    const result = await router.classify({
      mode: "agent",
      userMessage: "Fix the edge case in the utility helper",
    });

    expect(provider.callCount).toBe(1);
    expect(result.classification.taskHints?.targets?.[0]?.value).toBe(
      "src/hidden/util.ts",
    );
    expect(result.classification.taskHints?.recommendedSkillTags).toEqual([
      "localize",
      "null-safety",
    ]);
  });
});

describe("TaskAnalyzer hint merge", () => {
  it("merges LLM targets that deterministic extraction missed", () => {
    const analyzer = new TaskAnalyzer();
    const analysis = analyzer.analyze({
      userMessage: "Fix the edge case in the utility helper",
      intent: baseIntent({
        taskHints: {
          targets: [
            { kind: "file", value: "src/hidden/util.ts", explicit: true },
          ],
          constraints: ["Do not change public APIs"],
          requestedOutcomes: ["Utility edge case passes"],
          clarity: "unclear",
          recommendedSkillTags: ["localize"],
        },
      }),
    });

    expect(
      analysis.targets.some(
        (target) =>
          target.kind === "file" && target.value === "src/hidden/util.ts",
      ),
    ).toBe(true);
    expect(analysis.constraints).toContain("Do not change public APIs");
    expect(analysis.requestedOutcomes).toContain("Utility edge case passes");
    expect(analysis.clarity).toBe("unclear");
  });
});
