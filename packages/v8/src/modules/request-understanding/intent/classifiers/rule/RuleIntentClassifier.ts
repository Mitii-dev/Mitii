
import { INTENT_CONSTANTS } from '../../constants';
import { IntentClassification } from '../../schema';
import { TaskIntent } from '../../types';
import type { RulePrior } from '../../evidence';
import {
  hasNonNegatedMutationVerb,
  isHardWholeRequestReadOnlyConstraint,
  isWholeRequestReadOnlyConstraint,
} from '../../isWholeRequestReadOnlyConstraint';
import { PATTERNS } from './RulePatterns';

/**
 * Deterministic intent classifier.
 *
 * Responsibilities:
 * - Recognize exact intent values.
 * - Recognize explicit slash commands.
 * - Detect explicit interaction constraints.
 * - Handle only unambiguous natural-language matches.
 *
 * Returns null when:
 * - No intent matches.
 * - The interaction intent is unclear.
 * - LLM classification is safer.
 */
export class RuleIntentClassifier {
  
  /**
   * Checks whether a string is a supported task intent.
   */
  private hasIntent = (intent: string): intent is TaskIntent => {
    return (
      INTENT_CONSTANTS.TASK_INTENTS as readonly string[]
    ).includes(intent);
  };

  /**
   * Classifies deterministic and sufficiently unambiguous messages.
   *
   * Returns null when LLM classification is required.
   */
  classifyMessage = (
    message: string,
  ): IntentClassification | null => {
    const text = message.trim();

    if (!text) {
      return null;
    }

    const normalizedText = text.toLowerCase();

    // 1. Exact internal intent value.
    if (this.hasIntent(normalizedText)) {
      return this.buildClassification({
        intent: normalizedText,
        interactionIntent:
          this.getExplicitIntentDefault(normalizedText),
        confidence: 1,
        reason: 'Matched exact task-intent value.',
      });
    }

    // 2. Explicit slash command.
    const commandIntent = this.matchExplicitCommand(text);

    if (commandIntent) {
      const remainingMessage = text
        .replace(/^\/[a-z][a-z_-]*\b/i, '')
        .trim();

      const detectedInteraction = remainingMessage
        ? this.detectInteractionIntent(remainingMessage)
        : undefined;

      return this.buildClassification({
        intent: commandIntent,
        interactionIntent:
          detectedInteraction ??
          this.getExplicitIntentDefault(commandIntent),
        confidence: 1,
        reason: `Matched explicit /${commandIntent} command.`,
      });
    }

    // 3. Acknowledgements and greetings are not technical task intents.
    if (
      text.length < 50 &&
      PATTERNS.ACKNOWLEDGEMENT_ONLY_PATTERN.test(text)
    ) {
      return null;
    }

    // 4. Detect the interaction boundary independently.
    const interactionIntent =
      this.detectInteractionIntent(text);

    // 5. Collect every matching task candidate.
    const matchedRules = PATTERNS.INTENT_PATTERNS.filter((rule) =>
      rule.pattern.test(text),
    );

    // No deterministic task candidate.
    if (matchedRules.length === 0) {
      return null;
    }

    // Task matched, but mutation/planning behavior remains unclear.
    if (!interactionIntent) {
      return null;
    }

    // Single unambiguous match.
    if (matchedRules.length === 1) {
      const matchedRule = matchedRules[0];
      if (!matchedRule) {
        return null;
      }

      return this.buildClassification({
        intent: matchedRule.intent,
        interactionIntent,
        confidence: matchedRule.confidence,
        reason:
          `Matched one unambiguous natural-language heuristic ` +
          `for ${matchedRule.intent}.`,
      });
    }

    // Multiple matches: keep a weak heuristic channel for SuperIntent
    // instead of dropping the rule ballot entirely.
    const byIntent = new Map<
      TaskIntent,
      { intent: TaskIntent; confidence: number }
    >();
    for (const rule of matchedRules) {
      const existing = byIntent.get(rule.intent);
      if (!existing || rule.confidence > existing.confidence) {
        byIntent.set(rule.intent, {
          intent: rule.intent,
          confidence: rule.confidence,
        });
      }
    }
    const sorted = [...byIntent.values()].sort(
      (first, second) => second.confidence - first.confidence,
    );
    const primary = sorted[0];
    if (!primary) {
      return null;
    }

    // Same intent matched via multiple patterns — still unambiguous.
    if (sorted.length === 1) {
      return this.buildClassification({
        intent: primary.intent,
        interactionIntent,
        confidence: primary.confidence,
        reason:
          `Matched natural-language heuristic(s) ` +
          `for ${primary.intent}.`,
      });
    }

    const alternatives = sorted.slice(1, INTENT_CONSTANTS.MAX_ALTERNATIVES + 1).map(
      (rule) => ({
        intent: rule.intent,
        confidence: Math.max(0.35, rule.confidence - 0.15),
      }),
    );

    return {
      interactionIntent,
      primaryTaskIntent: primary.intent,
      secondaryTaskIntents: alternatives
        .map((alternative) => alternative.intent)
        .slice(0, INTENT_CONSTANTS.MAX_SECONDARY),
      confidence: Math.max(0.55, primary.confidence - 0.15),
      alternatives,
      needsClarification: false,
      reason:
        `Matched ${sorted.length} natural-language heuristics; ` +
        `using ${primary.intent} as the primary with alternatives.`,
    };
  };

  /**
   * Top heuristic / explicit hits for the Officer evidence pack.
   * Returns priors even when interaction is unclear (classifyMessage → null).
   */
  listPriors = (message: string): RulePrior[] => {
    const text = message.trim();
    if (!text) {
      return [];
    }

    const classified = this.classifyMessage(text);
    if (classified && classified.confidence === 1) {
      return [
        {
          intent: classified.primaryTaskIntent,
          interactionIntent: classified.interactionIntent,
          confidence: 1,
          source: "explicit_rule",
          ...(classified.reason ? { reason: classified.reason } : {}),
        },
      ];
    }

    if (classified) {
      const priors: RulePrior[] = [
        {
          intent: classified.primaryTaskIntent,
          interactionIntent: classified.interactionIntent,
          confidence: classified.confidence,
          source: "heuristic_rule",
          ...(classified.reason ? { reason: classified.reason } : {}),
        },
      ];
      for (const alternative of classified.alternatives.slice(0, 2)) {
        priors.push({
          intent: alternative.intent,
          confidence: alternative.confidence,
          source: "heuristic_rule",
        });
      }
      return priors.slice(0, 3);
    }

    // Soft priors when interaction was unclear but task patterns matched.
    const matchedRules = PATTERNS.INTENT_PATTERNS.filter((rule) =>
      rule.pattern.test(text),
    );
    const byIntent = new Map<TaskIntent, number>();
    for (const rule of matchedRules) {
      const existing = byIntent.get(rule.intent) ?? 0;
      if (rule.confidence > existing) {
        byIntent.set(rule.intent, rule.confidence);
      }
    }
    return [...byIntent.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([intent, confidence]) => ({
        intent,
        confidence,
        source: "heuristic_rule" as const,
        reason: `Matched heuristic for ${intent} (interaction unclear).`,
      }));
  };

  /**
   * Extracts an explicit slash command when it maps to a TaskIntent.
   */
  private matchExplicitCommand(
    text: string,
  ): TaskIntent | null {
    const commandMatch =
      /^\/([a-z][a-z_-]*)\b/i.exec(text);

    if (!commandMatch) {
      return null;
    }

    const command =
      commandMatch[1]
        ?.toLowerCase();

    if (!command) {
      return null;
    }

    return this.hasIntent(command) ? command : null;
  }

  /**
   * Determines whether the user wants a question answered,
   * a plan created, or changes applied.
   *
   * Precedence is important:
   * 1. Explicit plan-only constraint
   * 2. Hard whole-request no-change constraint
   * 3. Soft whole-request read-only
   * 4. Question-shaped + later non-negated act → act ("explain and fix")
   * 5. Question-shaped request
   * 6. Explicit modification request
   * 7. Read-only investigation
   */
  private detectInteractionIntent(
    text: string,
  ): IntentClassification['interactionIntent'] | null {
    if (PATTERNS.PLAN_PATTERN.test(text)) {
      return 'plan';
    }

    if (isHardWholeRequestReadOnlyConstraint(text)) {
      return 'question';
    }

    // Whole-request read-only only — scoped "Do not refactor Tablet…" must
    // not force interaction=question on an otherwise mutating ask.
    if (isWholeRequestReadOnlyConstraint(text)) {
      return 'question';
    }

    if (PATTERNS.QUESTION_PATTERN.test(text)) {
      // Trailing / embedded non-negated mutation beats a leading explain/how.
      if (hasNonNegatedMutationVerb(text)) {
        return 'act';
      }
      return 'question';
    }

    if (PATTERNS.ACT_PATTERN.test(text)) {
      return 'act';
    }

    if (PATTERNS.READ_ONLY_PATTERN.test(text)) {
      return 'question';
    }

    return null;
  }

  /**
   * Provides a safe interaction default only for explicit intent values
   * and slash commands.
   *
   * These defaults are not used for normal natural-language requests.
   */
  private getExplicitIntentDefault(
    intent: TaskIntent,
  ): IntentClassification['interactionIntent'] {
    switch (intent) {
      case 'question':
      case 'diagnose':
      case 'audit':
      case 'review':
      case 'trace':
        return 'question';

      default:
        return 'act';
    }
  }

  /**
   * Creates a schema-compliant classification payload.
   */
  private buildClassification({
    intent,
    interactionIntent,
    confidence,
    reason,
  }: {
    intent: TaskIntent;
    interactionIntent:
      IntentClassification['interactionIntent'];
    confidence: number;
    reason: string;
  }): IntentClassification {
    return {
      interactionIntent,
      primaryTaskIntent: intent,
      secondaryTaskIntents: [],
      confidence,
      alternatives: [],
      needsClarification: false,
      reason,
    };
  }
}
