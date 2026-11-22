import type { AgentMode } from "../../../request-intake";

import { INTENT_CONSTANTS } from "../constants";
import { intentClassificationSchema } from "../schema";
import type {
  IntentClassifierResult,
  SuperIntentInput,
  SuperIntentOptions,
  SuperIntentResult,
  TaskIntent,
} from "../types";
import {
  buildClarification,
  buildResolutionReason,
  evaluateClarificationRecommendation,
  resolveSecondaryIntents,
} from "./clarification";
import {
  acceptsHighConfidenceLlmAction,
  applyModePolicy,
  resolveInteractionIntent,
} from "./interactionPolicy";
import {
  adjustIntentScore,
  clampScore,
  combineScores,
  findIntentScore,
  getSortedScores,
  promoteLlmPrimary,
  toScoreMap,
} from "./scoring";
import { validateSuperIntentOptions } from "./validateSuperIntentOptions";

export class SuperIntent {
  private readonly options: SuperIntentOptions;

  constructor(options: Partial<SuperIntentOptions> = {}) {
    this.options = {
      ...INTENT_CONSTANTS.SCORE_DEFAULT_OPTIONS,
      ...options,
    };

    validateSuperIntentOptions(this.options);
  }

  /**
   * Combines Rule and LLM classifications into one resolved result.
   *
   * Explicit rules bypass weighted ensemble resolution because they
   * represent a direct user or system selection such as "/bugfix".
   */
  resolve(input: SuperIntentInput): SuperIntentResult {
    assertLlmResult(input.llmResult);

    if (input.ruleResult?.source === "explicit_rule") {
      return this.resolveExplicitRule(
        input.mode,
        input.ruleResult,
        input.llmResult,
      );
    }

    return this.resolveEnsemble(input);
  }

  private resolveExplicitRule(
    mode: AgentMode,
    ruleResult: IntentClassifierResult,
    llmResult: IntentClassifierResult,
  ): SuperIntentResult {
    const ruleClassification = ruleResult.classification;

    const interactionIntent = applyModePolicy(
      mode,
      ruleClassification.interactionIntent,
    );

    const finalClassification = intentClassificationSchema.parse({
      ...ruleClassification,
      interactionIntent,
      confidence: 1,
      needsClarification: false,
      reason:
        ruleClassification.reason ||
        `Explicitly selected ${ruleClassification.primaryTaskIntent}.`,
    });

    const llmPrimary = llmResult.classification.primaryTaskIntent;

    const taskAgreement = finalClassification.primaryTaskIntent === llmPrimary;

    const interactionAgreement =
      finalClassification.interactionIntent ===
      applyModePolicy(mode, llmResult.classification.interactionIntent);

    return {
      status: "accepted",
      classification: finalClassification,
      scores: [
        {
          intent: finalClassification.primaryTaskIntent,
          score: 1,
          ruleScore: 1,
          llmScore:
            finalClassification.primaryTaskIntent === llmPrimary
              ? llmResult.classification.confidence
              : findIntentScore(
                  llmResult.classification,
                  finalClassification.primaryTaskIntent,
                ),
        },
      ],
      confidenceMargin: 1,
      recommendsClarification: false,
      diagnostics: {
        ruleSource: ruleResult.source,
        ...(ruleResult
          .matchedRule
          ? {
              matchedRule:
                ruleResult
                  .matchedRule,
            }
          : {}),

        rulePrimaryIntent: ruleClassification.primaryTaskIntent,
        llmPrimaryIntent: llmPrimary,

        ruleInteractionIntent: ruleClassification.interactionIntent,
        llmInteractionIntent: llmResult.classification.interactionIntent,

        taskAgreement,
        interactionAgreement,
        interactionConflict: false,

        agreementBonusApplied: 0,
        disagreementPenaltyApplied: 0,

        minimumConfidence: this.options.minimumConfidence,
        minimumMargin: this.options.minimumMargin,
      },
    };
  }

  private resolveEnsemble(input: SuperIntentInput): SuperIntentResult {
    const { mode, ruleResult, llmResult } = input;

    const llmClassification = llmResult.classification;

    const ruleClassification = ruleResult?.classification;

    const ruleScoreMap = ruleClassification
      ? toScoreMap(ruleClassification)
      : new Map<TaskIntent, number>();

    const llmScoreMap = toScoreMap(llmClassification);

    const combinedScores = combineScores(
      ruleScoreMap,
      llmScoreMap,
      Boolean(ruleClassification),
      this.options,
    );

    const taskAgreement = Boolean(
      ruleClassification &&
      ruleClassification.primaryTaskIntent ===
        llmClassification.primaryTaskIntent,
    );

    const rawInteractionConflict = Boolean(
      ruleClassification &&
      ruleClassification.interactionIntent !==
        llmClassification.interactionIntent,
    );

    const interactionIntent =
      resolveInteractionIntent({
        mode,
        ...(ruleClassification
          ? {
              ruleInteraction:
                ruleClassification
                  .interactionIntent,
            }
          : {}),
        llmInteraction:
          llmClassification
            .interactionIntent,
        llmPrimaryIntent:
          llmClassification
            .primaryTaskIntent,
        llmConfidence:
          llmClassification
            .confidence,
      });
    const llmMeetsAuthority =
      llmClassification.confidence >= INTENT_CONSTANTS.HIGH_CONFIDENCE;
    const acceptedHighConfidenceLlmAction =
      acceptsHighConfidenceLlmAction({
        interactionIntent,
        llmClassification,
      });
    /*
     * Ask and Plan modes deterministically resolve the interaction boundary.
     * A raw classifier conflict matters only in Agent mode — unless the LLM
     * is ≥ HIGH_CONFIDENCE (e.g. act vs rule question → trust LLM act).
     */
    const interactionConflict =
      mode === "agent" &&
      rawInteractionConflict &&
      !acceptedHighConfidenceLlmAction &&
      !(llmMeetsAuthority && Boolean(ruleClassification));

    const interactionAgreement = !interactionConflict;
    const ruleInteractionAgrees = Boolean(
      ruleClassification &&
        ruleClassification.interactionIntent ===
          llmClassification.interactionIntent,
    );

    let agreementBonusApplied = 0;
    let disagreementPenaltyApplied = 0;

    if (taskAgreement) {
      // Rule + LLM same task → confidence grows.
      agreementBonusApplied = this.options.agreementBonus;
      adjustIntentScore(
        combinedScores,
        llmClassification.primaryTaskIntent,
        agreementBonusApplied,
      );
      if (ruleInteractionAgrees) {
        // Full agreement (task + interaction) — grow a bit more.
        const extra = this.options.agreementBonus * 0.5;
        agreementBonusApplied = clampScore(agreementBonusApplied + extra);
        adjustIntentScore(
          combinedScores,
          llmClassification.primaryTaskIntent,
          extra,
        );
      }
    } else if (ruleClassification) {
      // Officer authority: lock task primary to the LLM ballot. Rules are priors.
      promoteLlmPrimary(combinedScores, llmClassification);
    }

    const sortedScores = getSortedScores(combinedScores);

    if (sortedScores.length === 0) {
      throw new Error("SuperIntent could not produce any task-intent score.");
    }

    const primaryScore =
      sortedScores[0]!;

    const alternativeScores = sortedScores.slice(
      1,
      this.options.maximumAlternatives + 1,
    );

    const bestAlternativeScore = alternativeScores[0]?.score ?? 0;

    const confidenceMargin = clampScore(
      primaryScore.score - bestAlternativeScore,
    );

    const secondaryTaskIntents = resolveSecondaryIntents({
      primaryIntent: primaryScore.intent,
      ...(ruleClassification
        ? {
            ruleClassification,
          }
        : {}),
      llmClassification,
      options: this.options,
    });

    const recommendsClarification = evaluateClarificationRecommendation({
      primaryConfidence: primaryScore.score,
      confidenceMargin,
      interactionConflict,
      ...(ruleClassification
        ? {
            ruleClassification,
          }
        : {}),
      llmClassification,
      options: this.options,
    });

    const reason = buildResolutionReason({
      primaryIntent: primaryScore.intent,
      primaryConfidence: primaryScore.score,
      taskAgreement,
      interactionConflict,
      recommendsClarification,
    });

    const finalClassification = intentClassificationSchema.parse({
      interactionIntent,
      primaryTaskIntent: primaryScore.intent,
      secondaryTaskIntents,
      confidence: primaryScore.score,
      alternatives: alternativeScores.map((alternative) => ({
        intent: alternative.intent,
        confidence: alternative.score,
      })),
      needsClarification: recommendsClarification,
      reason,
      // Preserve optional LLM taskHints (evidence only; never authority).
      ...(llmClassification.taskHints
        ? { taskHints: llmClassification.taskHints }
        : {}),
    });

    const result: SuperIntentResult = {
      status: recommendsClarification ? "clarification_required" : "accepted",

      classification: finalClassification,
      scores: sortedScores,
      confidenceMargin,
      recommendsClarification,

      diagnostics: {
        ...(ruleResult
          ? {
              ruleSource:
                ruleResult
                  .source,
            }
          : {}),
        ...(ruleResult
          ?.matchedRule
          ? {
              matchedRule:
                ruleResult
                  .matchedRule,
            }
          : {}),

        ...(ruleClassification
          ? {
              rulePrimaryIntent:
                ruleClassification
                  .primaryTaskIntent,
              ruleInteractionIntent:
                ruleClassification
                  .interactionIntent,
            }
          : {}),

        llmPrimaryIntent: llmClassification.primaryTaskIntent,

        llmInteractionIntent: llmClassification.interactionIntent,

        taskAgreement,
        interactionAgreement,
        interactionConflict,

        agreementBonusApplied,
        disagreementPenaltyApplied,

        minimumConfidence: this.options.minimumConfidence,
        minimumMargin: this.options.minimumMargin,
      },
    };

    if (recommendsClarification) {
      result.clarification = buildClarification(finalClassification, this.options);
    }

    return result;
  }
}

function assertLlmResult(result: IntentClassifierResult): void {
  if (result.source !== "llm") {
    throw new Error('SuperIntent requires llmResult.source to be "llm".');
  }
}
