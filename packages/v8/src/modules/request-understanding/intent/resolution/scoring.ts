import type { IntentClassification } from "../schema";
import type {
  SuperIntentOptions,
  SuperIntentScore,
  TaskIntent,
} from "../types";

export function clampScore(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export function toScoreMap(
  classification: IntentClassification,
): Map<TaskIntent, number> {
  const scores = new Map<TaskIntent, number>();

  scores.set(classification.primaryTaskIntent, classification.confidence);

  for (const alternative of classification.alternatives) {
    const existing = scores.get(alternative.intent) ?? 0;

    scores.set(alternative.intent, Math.max(existing, alternative.confidence));
  }

  return scores;
}

export function findIntentScore(
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

export function combineScores(
  ruleScores: ReadonlyMap<TaskIntent, number>,
  llmScores: ReadonlyMap<TaskIntent, number>,
  hasRuleResult: boolean,
  options: SuperIntentOptions,
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
      ? ruleScore * options.heuristicRuleWeight + llmScore * options.llmWeight
      : llmScore;

    combined.set(intent, {
      intent,
      score: clampScore(score),
      ruleScore,
      llmScore,
    });
  }

  return combined;
}

export function adjustIntentScore(
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
    score: clampScore(score.score + adjustment),
  });
}

export function getSortedScores(
  scores: ReadonlyMap<TaskIntent, SuperIntentScore>,
): SuperIntentScore[] {
  return [...scores.values()].sort(
    (first, second) => second.score - first.score,
  );
}

/**
 * When the LLM is ≥ HIGH_CONFIDENCE and disagrees with rules, lock the
 * combined primary to the LLM ballot so blend math cannot flip it.
 */
export function promoteLlmPrimary(
  scores: Map<TaskIntent, SuperIntentScore>,
  llmClassification: IntentClassification,
): void {
  const intent = llmClassification.primaryTaskIntent;
  const existing = scores.get(intent);
  const floor = llmClassification.confidence;
  if (existing) {
    scores.set(intent, {
      ...existing,
      score: clampScore(Math.max(existing.score, floor)),
    });
    return;
  }
  scores.set(intent, {
    intent,
    score: clampScore(floor),
    ruleScore: 0,
    llmScore: floor,
  });
}
