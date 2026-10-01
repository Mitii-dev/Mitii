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
    expect(result.diagnostics.taskAgreement).toBe(false);
    expect(result.classification.confidence).toBe(1);
  });

  it("preserves high-confidence implementation follow-ups as actions", async () => {
    const provider = new StaticLlmPort({
      interactionIntent: "act",
      primaryTaskIntent: "feature",
      secondaryTaskIntents: ["schema"],
      confidence: 0.92,
      alternatives: [{ intent: "schema", confidence: 0.1 }],
      needsClarification: false,
      reason: "The user explicitly asks to start the implementation.",
    });
    const router = new IntentRouter(provider, {
      ruleClassifier: {
        classifyMessage: () => ({
          interactionIntent: "question",
          primaryTaskIntent: "question",
          secondaryTaskIntents: [],
          confidence: 0.8,
          alternatives: [],
          needsClarification: false,
          reason: "Conservative heuristic fallback.",
        }),
      },
    });

    const result = await router.classify({
      mode: "agent",
      userMessage: "STart the implemnetation",
    });

    expect(result.classification.primaryTaskIntent).toBe("feature");
    expect(result.classification.interactionIntent).toBe("act");
    expect(result.status).toBe("accepted");
    expect(result.recommendsClarification).toBe(false);
    expect(result.diagnostics.interactionConflict).toBe(false);
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
  it("merges LLM targets that deterministic extraction missed as non-explicit without a repo map", () => {
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

    const hinted = analysis.targets.find(
      (target) =>
        target.kind === "file" && target.value === "src/hidden/util.ts",
    );
    expect(hinted).toBeDefined();
    expect(hinted?.explicit).toBe(false);
    expect(analysis.constraints).toContain("Do not change public APIs");
    expect(analysis.requestedOutcomes).toContain("Utility edge case passes");
    expect(analysis.clarity).toBe("unclear");
  });

  it("keeps LLM file hints explicit when they match the repo-map candidates", () => {
    const analyzer = new TaskAnalyzer();
    const analysis = analyzer.analyze({
      userMessage: "Fix the edge case in the utility helper",
      intent: baseIntent({
        taskHints: {
          targets: [
            { kind: "file", value: "src/hidden/util.ts", explicit: true },
          ],
          constraints: [],
          requestedOutcomes: [],
          recommendedSkillTags: [],
        },
      }),
      candidateRelativePaths: ["src/hidden/util.ts", "src/other.ts"],
    });

    const hinted = analysis.targets.find(
      (target) => target.value === "src/hidden/util.ts",
    );
    expect(hinted?.explicit).toBe(true);
  });

  it("emits both symbol and file targets for symbol artifacts", () => {
    const analyzer = new TaskAnalyzer();
    const analysis = analyzer.analyze({
      userMessage: "Fix the null check",
      intent: baseIntent(),
      referencedArtifacts: [
        {
          kind: "symbol",
          name: "signIn",
          path: "src/LoginForm.tsx",
        },
      ],
    });

    expect(
      analysis.targets.some(
        (target) => target.kind === "symbol" && target.value === "signIn",
      ),
    ).toBe(true);
    expect(
      analysis.targets.some(
        (target) =>
          target.kind === "file" && target.value === "src/LoginForm.tsx",
      ),
    ).toBe(true);
  });
});

describe("RuleIntentClassifier interaction and multi-match", () => {
  const classifier = new RuleIntentClassifier();

  it("treats explain-and-fix as act", () => {
    const result = classifier.classifyMessage(
      "Explain the crash and fix it in parse.ts",
    );
    expect(result?.interactionIntent).toBe("act");
    expect(result?.primaryTaskIntent).toBe("bugfix");
  });

  it("keeps explain-only and do-not-fix as question", () => {
    expect(
      classifier.classifyMessage("Do not fix it; explain the crash")
        ?.interactionIntent,
    ).toBe("question");
  });

  it("keeps a weak heuristic when multiple task patterns match", () => {
    const result = classifier.classifyMessage(
      "Add an API endpoint and write unit tests for it",
    );
    expect(result).not.toBeNull();
    expect(result?.primaryTaskIntent).toMatch(/feature|test/);
    expect(
      [result?.primaryTaskIntent, ...(result?.alternatives.map((a) => a.intent) ?? [])],
    ).toEqual(expect.arrayContaining(["feature", "test"]));
  });

  it("matches Fix the login button as bugfix", () => {
    const result = classifier.classifyMessage("Fix the login button");
    expect(result?.primaryTaskIntent).toBe("bugfix");
    expect(result?.interactionIntent).toBe("act");
  });

  it("does not classify Make this component faster as style", () => {
    const result = classifier.classifyMessage(
      "Make this component faster",
    );
    expect(result?.primaryTaskIntent).not.toBe("style");
  });
});
