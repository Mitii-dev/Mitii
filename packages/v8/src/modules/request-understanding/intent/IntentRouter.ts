import type {
  LlmPort,
} from "../../model-gateway";
import { LlmIntentClassifier, RuleIntentClassifier } from "./classifiers";
import { extractPrimaryUserMessage } from "./extractPrimaryUserMessage";
import { ModeIntentPolicy } from "./policy";
import { SuperIntent } from "./resolution";
import { INTENT_CONSTANTS } from "./constants";
import {
  IntentClassificationInput,
  IntentClassifierResult,
  IntentRouterDependencies,
  LlmIntentClassifierPort,
  RuleIntentClassifierPort,
  SuperIntentResult,
} from "./types";

/** Pending: Emitting Activity:  emitActivity */
export class IntentRouter {
  private readonly ruleClassifier:
    RuleIntentClassifierPort;
  private readonly llmClassifier:
    LlmIntentClassifierPort;
  private readonly modePolicy: ModeIntentPolicy;

  constructor(
    provider: LlmPort,
    dependencies: IntentRouterDependencies = {},
  ) {
    this.ruleClassifier =
      dependencies.ruleClassifier ?? new RuleIntentClassifier();

    this.llmClassifier =
      dependencies.llmClassifier ?? new LlmIntentClassifier(provider);

    this.modePolicy = new ModeIntentPolicy();
  }

  async classify(input: IntentClassificationInput): Promise<SuperIntentResult> {
    const normalizedInput = this.normalizeInput(input);

    // 1. Attempt Rule classification first.
    const ruleClassification = this.ruleClassifier.classifyMessage(
      normalizedInput.userMessage,
    );
    const ruleResult = ruleClassification
      ? {
          source:
            ruleClassification.confidence === 1
              ? ("explicit_rule" as const)
              : ("heuristic_rule" as const),
          classification: ruleClassification,
          ...(ruleClassification
            .reason
            ? {
                matchedRule:
                  ruleClassification
                    .reason,
              }
            : {}),
        }
      : null;

    // 2. Attempt LLM classification (fall back to rule/safe default on failure).
    let llmResult: IntentClassifierResult;
    try {
      const llmClassification = await this.modePolicy.apply(
        normalizedInput.mode,
        await this.llmClassifier.classify(normalizedInput),
      );
      llmResult = {
        source: "llm",
        classification: llmClassification,
      };
    } catch (error) {
      if (ruleResult) {
        return this.buildFallbackResult(normalizedInput.mode, ruleResult, error);
      }
      return this.buildSafeFallbackResult(normalizedInput.mode, error);
    }

    // 3. Resolve final classification using SuperIntent.
    const superIntent = new SuperIntent();
    const result = superIntent.resolve({
      mode: input.mode,
      ruleResult,
      llmResult,
    });

    return result;
  }

  private normalizeInput(
    input: IntentClassificationInput,
  ): Required<IntentClassificationInput> {
    return {
      mode: input.mode,
      userMessage: extractPrimaryUserMessage(input.userMessage),
      referencedArtifacts: input.referencedArtifacts ?? [],
    };
  }

  private buildFallbackResult(
    mode: IntentClassificationInput["mode"],
    ruleResult: IntentClassifierResult,
    error: unknown,
  ): SuperIntentResult {
    const classification = this.modePolicy.apply(mode, ruleResult.classification);
    const detail =
      error instanceof Error ? error.message.slice(0, 160) : String(error).slice(0, 160);
    return {
      status: "accepted",
      classification: {
        ...classification,
        reason: `${classification.reason ?? "Rule classification."} LLM unavailable; using rule fallback (${detail}).`,
      },
      scores: [
        {
          intent: classification.primaryTaskIntent,
          score: classification.confidence,
          ruleScore: classification.confidence,
          llmScore: 0,
        },
      ],
      confidenceMargin: classification.confidence,
      recommendsClarification: false,
      diagnostics: {
        ruleSource: ruleResult.source,
        ...(ruleResult.matchedRule
          ? { matchedRule: ruleResult.matchedRule }
          : {}),
        rulePrimaryIntent: ruleResult.classification.primaryTaskIntent,
        llmPrimaryIntent: classification.primaryTaskIntent,
        ruleInteractionIntent: ruleResult.classification.interactionIntent,
        llmInteractionIntent: classification.interactionIntent,
        taskAgreement: false,
        interactionAgreement: true,
        interactionConflict: false,
        agreementBonusApplied: 0,
        disagreementPenaltyApplied: 0,
        minimumConfidence: INTENT_CONSTANTS.SCORE_DEFAULT_OPTIONS.minimumConfidence,
        minimumMargin: INTENT_CONSTANTS.SCORE_DEFAULT_OPTIONS.minimumMargin,
      },
    };
  }

  private buildSafeFallbackResult(
    mode: IntentClassificationInput["mode"],
    error: unknown,
  ): SuperIntentResult {
    const detail =
      error instanceof Error ? error.message.slice(0, 160) : String(error).slice(0, 160);
    const classification = this.modePolicy.apply(mode, {
      interactionIntent: "question",
      primaryTaskIntent: "question",
      secondaryTaskIntents: [],
      confidence: 0.45,
      alternatives: [],
      needsClarification: false,
      reason: `LLM intent classifier failed; using safe question fallback (${detail}).`,
    });
    return {
      status: "accepted",
      classification,
      scores: [
        {
          intent: classification.primaryTaskIntent,
          score: classification.confidence,
          ruleScore: 0,
          llmScore: 0,
        },
      ],
      confidenceMargin: classification.confidence,
      recommendsClarification: false,
      diagnostics: {
        llmPrimaryIntent: classification.primaryTaskIntent,
        llmInteractionIntent: classification.interactionIntent,
        taskAgreement: false,
        interactionAgreement: true,
        interactionConflict: false,
        agreementBonusApplied: 0,
        disagreementPenaltyApplied: 0,
        minimumConfidence: INTENT_CONSTANTS.SCORE_DEFAULT_OPTIONS.minimumConfidence,
        minimumMargin: INTENT_CONSTANTS.SCORE_DEFAULT_OPTIONS.minimumMargin,
      },
    };
  }
}
