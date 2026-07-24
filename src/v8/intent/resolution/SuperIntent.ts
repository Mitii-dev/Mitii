import { ThunderSession } from "../../../features/ce/session";
import { INTENT_CATALOG } from "../catalog";
import { INTENT_CONSTANTS } from "../constants";

import { intentClassificationSchema } from "../schema";

import type { IntentClassification, InteractionIntent } from "../schema";

import type {
  IntentClassifierResult,
  SuperIntentClarification,
  SuperIntentInput,
  SuperIntentOptions,
  SuperIntentResult,
  SuperIntentScore,
  TaskIntent,
} from "../types";

export class SuperIntent {
  private readonly options: SuperIntentOptions;

  constructor(options: Partial<SuperIntentOptions> = {}) {
    this.options = {
      ...INTENT_CONSTANTS.SCORE_DEFAULT_OPTIONS,
      ...options,
    };

    this.validateOptions();
  }

  /**
   * Combines Rule and LLM classifications into one resolved result.
   *
   * Explicit rules bypass weighted ensemble resolution because they
   * represent a direct user or system selection such as "/bugfix".
   */
  resolve(input: SuperIntentInput): SuperIntentResult {
    this.assertLlmResult(input.llmResult);

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
    mode: ThunderSession["mode"],
    ruleResult: IntentClassifierResult,
    llmResult: IntentClassifierResult,
  ): SuperIntentResult {
    const ruleClassification = ruleResult.classification;

    const interactionIntent = this.applyModePolicy(
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
      this.applyModePolicy(mode, llmResult.classification.interactionIntent);

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
              : this.findIntentScore(
                  llmResult.classification,
                  finalClassification.primaryTaskIntent,
                ),
        },
      ],
      confidenceMargin: 1,
      requiresClarification: false,
      diagnostics: {
        ruleSource: ruleResult.source,
        matchedRule: ruleResult.matchedRule,

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
      ? this.toScoreMap(ruleClassification)
      : new Map<TaskIntent, number>();

    const llmScoreMap = this.toScoreMap(llmClassification);

    const combinedScores = this.combineScores(
      ruleScoreMap,
      llmScoreMap,
      Boolean(ruleClassification),
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

    const interactionIntent = this.resolveInteractionIntent({
      mode,
      ruleInteraction: ruleClassification?.interactionIntent,
      llmInteraction: llmClassification.interactionIntent,
    });

    /*
     * Ask and Plan modes deterministically resolve the interaction boundary.
     * A raw classifier conflict matters only in Agent mode.
     */
    const interactionConflict = mode === "agent" && rawInteractionConflict;

    const interactionAgreement = !interactionConflict;

    let agreementBonusApplied = 0;
    let disagreementPenaltyApplied = 0;

    if (taskAgreement) {
      agreementBonusApplied = this.options.agreementBonus;

      const agreedIntent = llmClassification.primaryTaskIntent;

      this.adjustIntentScore(
        combinedScores,
        agreedIntent,
        agreementBonusApplied,
      );
    } else if (ruleClassification) {
      disagreementPenaltyApplied = this.options.disagreementPenalty;

      const currentWinner = this.getSortedScores(combinedScores)[0];

      if (currentWinner) {
        this.adjustIntentScore(
          combinedScores,
          currentWinner.intent,
          -disagreementPenaltyApplied,
        );
      }
    }

    const sortedScores = this.getSortedScores(combinedScores);

    if (sortedScores.length === 0) {
      throw new Error("SuperIntent could not produce any task-intent score.");
    }

    const primaryScore = sortedScores[0];

    const alternativeScores = sortedScores.slice(
      1,
      this.options.maximumAlternatives + 1,
    );

    const bestAlternativeScore = alternativeScores[0]?.score ?? 0;

    const confidenceMargin = this.clamp(
      primaryScore.score - bestAlternativeScore,
    );

    const secondaryTaskIntents = this.resolveSecondaryIntents({
      primaryIntent: primaryScore.intent,
      ruleClassification,
      llmClassification,
    });

    const requiresClarification = this.requiresClarification({
      primaryConfidence: primaryScore.score,
      confidenceMargin,
      interactionConflict,
      ruleClassification,
      llmClassification,
    });

    const reason = this.buildResolutionReason({
      primaryIntent: primaryScore.intent,
      primaryConfidence: primaryScore.score,
      taskAgreement,
      interactionConflict,
      requiresClarification,
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
      needsClarification: requiresClarification,
      reason,
    });

    const result: SuperIntentResult = {
      status: requiresClarification ? "clarification_required" : "accepted",

      classification: finalClassification,
      scores: sortedScores,
      confidenceMargin,
      requiresClarification,

      diagnostics: {
        ruleSource: ruleResult?.source,
        matchedRule: ruleResult?.matchedRule,

        rulePrimaryIntent: ruleClassification?.primaryTaskIntent,

        llmPrimaryIntent: llmClassification.primaryTaskIntent,

        ruleInteractionIntent: ruleClassification?.interactionIntent,

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

    if (requiresClarification) {
      result.clarification = this.buildClarification(finalClassification);
    }

    return result;
  }

  private combineScores(
    ruleScores: ReadonlyMap<TaskIntent, number>,
    llmScores: ReadonlyMap<TaskIntent, number>,
    hasRuleResult: boolean,
  ): Map<TaskIntent, SuperIntentScore> {
    const intents = new Set<TaskIntent>([
      ...ruleScores.keys(),
      ...llmScores.keys(),
    ]);

    const combined = new Map<TaskIntent, SuperIntentScore>();

    for (const intent of intents) {
      const ruleScore = ruleScores.get(intent) ?? 0;

      const llmScore = llmScores.get(intent) ?? 0;

      const score = hasRuleResult
        ? ruleScore * this.options.heuristicRuleWeight +
          llmScore * this.options.llmWeight
        : llmScore;

      combined.set(intent, {
        intent,
        score: this.clamp(score),
        ruleScore,
        llmScore,
      });
    }

    return combined;
  }

  private toScoreMap(
    classification: IntentClassification,
  ): Map<TaskIntent, number> {
    const scores = new Map<TaskIntent, number>();

    scores.set(classification.primaryTaskIntent, classification.confidence);

    for (const alternative of classification.alternatives) {
      const existing = scores.get(alternative.intent) ?? 0;

      scores.set(
        alternative.intent,
        Math.max(existing, alternative.confidence),
      );
    }

    return scores;
  }

  private findIntentScore(
    classification: IntentClassification,
    intent: TaskIntent,
  ): number {
    if (classification.primaryTaskIntent === intent) {
      return classification.confidence;
    }

    return (
      classification.alternatives.find(
        (alternative) => alternative.intent === intent,
      )?.confidence ?? 0
    );
  }

  private adjustIntentScore(
    scores: Map<TaskIntent, SuperIntentScore>,
    intent: TaskIntent,
    adjustment: number,
  ): void {
    const score = scores.get(intent);

    if (!score) {
      return;
    }

    scores.set(intent, {
      ...score,
      score: this.clamp(score.score + adjustment),
    });
  }

  private getSortedScores(
    scores: ReadonlyMap<TaskIntent, SuperIntentScore>,
  ): SuperIntentScore[] {
    return [...scores.values()].sort(
      (first, second) => second.score - first.score,
    );
  }

  private resolveInteractionIntent({
    mode,
    ruleInteraction,
    llmInteraction,
  }: {
    mode: ThunderSession["mode"];
    ruleInteraction?: InteractionIntent;
    llmInteraction: InteractionIntent;
  }): InteractionIntent {
    if (mode === "ask") {
      return "question";
    }

    if (mode === "plan") {
      return "plan";
    }

    if (!ruleInteraction || ruleInteraction === llmInteraction) {
      return llmInteraction;
    }

    /*
     * In Agent mode, use the safer interaction while clarification is
     * pending. The clarification decision will record the conflict.
     */
    if (ruleInteraction === "question" || llmInteraction === "question") {
      return "question";
    }

    if (ruleInteraction === "plan" || llmInteraction === "plan") {
      return "plan";
    }

    return "act";
  }

  private applyModePolicy(
    mode: ThunderSession["mode"],
    interactionIntent: InteractionIntent,
  ): InteractionIntent {
    if (mode === "ask") {
      return "question";
    }

    if (mode === "plan") {
      return "plan";
    }

    return interactionIntent;
  }

  private resolveSecondaryIntents({
    primaryIntent,
    ruleClassification,
    llmClassification,
  }: {
    primaryIntent: TaskIntent;
    ruleClassification?: IntentClassification;
    llmClassification: IntentClassification;
  }): TaskIntent[] {
    const secondaryIntents = new Set<TaskIntent>();

    for (const intent of llmClassification.secondaryTaskIntents) {
      if (intent !== primaryIntent) {
        secondaryIntents.add(intent);
      }
    }

    for (const intent of ruleClassification?.secondaryTaskIntents ?? []) {
      if (intent !== primaryIntent) {
        secondaryIntents.add(intent);
      }
    }

    return [...secondaryIntents].slice(0, this.options.maximumSecondaryIntents);
  }

  private requiresClarification({
    primaryConfidence,
    confidenceMargin,
    interactionConflict,
    ruleClassification,
    llmClassification,
  }: {
    primaryConfidence: number;
    confidenceMargin: number;
    interactionConflict: boolean;
    ruleClassification?: IntentClassification;
    llmClassification: IntentClassification;
  }): boolean {
    if (
      ruleClassification?.needsClarification ||
      llmClassification.needsClarification
    ) {
      return true;
    }

    if (interactionConflict) {
      return true;
    }

    if (primaryConfidence < this.options.minimumConfidence) {
      return true;
    }

    if (confidenceMargin < this.options.minimumMargin) {
      return true;
    }

    return false;
  }

  private buildResolutionReason({
    primaryIntent,
    primaryConfidence,
    taskAgreement,
    interactionConflict,
    requiresClarification,
  }: {
    primaryIntent: TaskIntent;
    primaryConfidence: number;
    taskAgreement: boolean;
    interactionConflict: boolean;
    requiresClarification: boolean;
  }): string {
    if (interactionConflict) {
      return (
        "Rule and LLM classifiers disagree about whether the request " +
        "permits changes."
      );
    }

    if (requiresClarification) {
      return (
        `The combined classification favors ${primaryIntent} ` +
        `with confidence ${primaryConfidence.toFixed(2)}, but the ` +
        "result does not meet the acceptance policy."
      );
    }

    if (taskAgreement) {
      return (
        `Rule and LLM classifiers agree on ${primaryIntent} ` +
        `with combined confidence ${primaryConfidence.toFixed(2)}.`
      );
    }

    return (
      `The combined evidence favors ${primaryIntent} ` +
      `with confidence ${primaryConfidence.toFixed(2)}.`
    );
  }

  private buildClarification(
    classification: IntentClassification,
  ): SuperIntentClarification {
    const candidateIntents = new Set<TaskIntent>([
      classification.primaryTaskIntent,
      ...classification.alternatives.map((alternative) => alternative.intent),
    ]);

    const options = [...candidateIntents]
      .slice(0, this.options.maximumClarificationOptions)
      .map((intent) => ({
        intent,
        label: this.humanizeIntent(intent),
        description: INTENT_CATALOG[intent].description,
        confidence: this.findIntentScore(classification, intent),
      }));

    return {
      question: "What outcome do you want from this request?",
      options,
    };
  }

  private humanizeIntent(intent: string): string {
    return intent
      .split("_")
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");
  }

  private clamp(value: number): number {
    return Math.min(1, Math.max(0, value));
  }

  private assertLlmResult(result: IntentClassifierResult): void {
    if (result.source !== "llm") {
      throw new Error('SuperIntent requires llmResult.source to be "llm".');
    }
  }

  private validateOptions(): void {
    const probabilityOptions: Array<keyof SuperIntentOptions> = [
      "llmWeight",
      "heuristicRuleWeight",
      "agreementBonus",
      "disagreementPenalty",
      "minimumConfidence",
      "minimumMargin",
    ];

    for (const option of probabilityOptions) {
      const value = this.options[option];

      if (typeof value !== "number" || value < 0 || value > 1) {
        throw new Error(
          `SuperIntent option "${option}" must be between 0 and 1.`,
        );
      }
    }

    const totalWeight =
      this.options.llmWeight + this.options.heuristicRuleWeight;

    if (Math.abs(totalWeight - 1) > Number.EPSILON * 10) {
      throw new Error(
        "SuperIntent LLM and heuristic-rule weights must total 1.",
      );
    }

    const countOptions: Array<keyof SuperIntentOptions> = [
      "maximumAlternatives",
      "maximumSecondaryIntents",
      "maximumClarificationOptions",
    ];

    for (const option of countOptions) {
      const value = this.options[option];

      if (!Number.isInteger(value) || value < 1) {
        throw new Error(
          `SuperIntent option "${option}" must be a positive integer.`,
        );
      }
    }
  }
}
