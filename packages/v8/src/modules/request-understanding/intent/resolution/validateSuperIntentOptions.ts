import type { SuperIntentOptions } from "../types";

export function validateSuperIntentOptions(options: SuperIntentOptions): void {
  const probabilityOptions: Array<keyof SuperIntentOptions> = [
    "llmWeight",
    "heuristicRuleWeight",
    "agreementBonus",
    "disagreementPenalty",
    "minimumConfidence",
    "minimumMargin",
  ];

  for (const option of probabilityOptions) {
    const value = options[option];

    if (typeof value !== "number" || value < 0 || value > 1) {
      throw new Error(
        `SuperIntent option "${option}" must be between 0 and 1.`,
      );
    }
  }

  const totalWeight = options.llmWeight + options.heuristicRuleWeight;

  if (Math.abs(totalWeight - 1) > Number.EPSILON * 10) {
    throw new Error("SuperIntent LLM and heuristic-rule weights must total 1.");
  }

  const countOptions: Array<keyof SuperIntentOptions> = [
    "maximumAlternatives",
    "maximumSecondaryIntents",
    "maximumClarificationOptions",
  ];

  for (const option of countOptions) {
    const value = options[option];

    if (!Number.isInteger(value) || value < 1) {
      throw new Error(
        `SuperIntent option "${option}" must be a positive integer.`,
      );
    }
  }
}
