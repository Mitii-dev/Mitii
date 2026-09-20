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
  ReferencedArtifact,
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

    // Explicit slash/exact intents are authoritative — skip the LLM round-trip.
    if (ruleResult?.source === "explicit_rule") {
      return this.buildExplicitRuleResult(normalizedInput.mode, ruleResult);
    }

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

  private normalizeInput(input: IntentClassificationInput): {
    mode: IntentClassificationInput["mode"];
    userMessage: string;
    referencedArtifacts: readonly ReferencedArtifact[];
    diagnosticSummary: IntentClassificationInput["diagnosticSummary"];
  } {
    return {
      mode: input.mode,
      userMessage: extractPrimaryUserMessage(input.userMessage),
      referencedArtifacts: input.referencedArtifacts ?? [],
      diagnosticSummary: input.diagnosticSummary,
    };
  }

  private buildExplicitRuleResult(
    mode: IntentClassificationInput["mode"],
    ruleResult: IntentClassifierResult,
  ): SuperIntentResult {
    const classification = this.modePolicy.apply(mode, {
      ...ruleResult.classification,
      confidence: 1,
      needsClarification: false,
      reason:
        ruleResult.classification.reason ||
        `Explicitly selected ${ruleResult.classification.primaryTaskIntent}.`,
    });

    return {
      status: "accepted",
      classification,
      scores: [
        {
          intent: classification.primaryTaskIntent,
          score: 1,
          ruleScore: 1,
          llmScore: 0,
        },
      ],
      confidenceMargin: 1,
      recommendsClarification: false,
      diagnostics: {
        ruleSource: "explicit_rule",
        ...(ruleResult.matchedRule
          ? { matchedRule: ruleResult.matchedRule }
          : {}),
        rulePrimaryIntent: ruleResult.classification.primaryTaskIntent,
        llmPrimaryIntent: classification.primaryTaskIntent,
        ruleInteractionIntent: ruleResult.classification.interactionIntent,
        llmInteractionIntent: classification.interactionIntent,
        taskAgreement: true,
        interactionAgreement: true,
        interactionConflict: false,
        agreementBonusApplied: 0,
        disagreementPenaltyApplied: 0,
        minimumConfidence: INTENT_CONSTANTS.SCORE_DEFAULT_OPTIONS.minimumConfidence,
        minimumMargin: INTENT_CONSTANTS.SCORE_DEFAULT_OPTIONS.minimumMargin,
      },
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
    // Agent: stay below Decision Policy lowIntentConfidence (0.45) so unclear
    // asks suspend for confirmation instead of tool-less chat.
    // Plan/Ask: pin interaction via ModeIntentPolicy and keep confidence at/above
    // INTENT_LOW (0.6) so a parse failure does not invent an empty-option clarify.
    const agentFallback = mode === "agent";
    const classification = this.modePolicy.apply(mode, {
      interactionIntent: mode === "plan" ? "plan" : "question",
      primaryTaskIntent: "question",
      secondaryTaskIntents: [],
      confidence: agentFallback ? 0.4 : 0.65,
      // Chips when Agent must clarify — avoid empty free-text only.
      alternatives: agentFallback
        ? [
            { intent: "bugfix", confidence: 0.28 },
            { intent: "feature", confidence: 0.26 },
            { intent: "refactor", confidence: 0.22 },
          ]
        : [],
      needsClarification: agentFallback,
      reason: `LLM intent classifier failed; using safe ${
        mode === "plan" ? "plan" : "question"
      } fallback (${detail}).`,
    });
    return {
      status: agentFallback ? "clarification_required" : "accepted",
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
      recommendsClarification: agentFallback,
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
