
import { INTENT_CONSTANTS } from '../../constants';
import { IntentClassification } from '../../schema';
import { TaskIntent } from '../../types';
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
 * - Multiple task intents match.
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

    // Multiple matches require semantic resolution by the LLM.
    if (matchedRules.length > 1) {
      return null;
    }

    // Task matched, but mutation/planning behavior remains unclear.
    if (!interactionIntent) {
      return null;
    }

    const matchedRule = matchedRules[0];

    return this.buildClassification({
      intent: matchedRule.intent,
      interactionIntent,
      confidence: matchedRule.confidence,
      reason:
        `Matched one unambiguous natural-language heuristic ` +
        `for ${matchedRule.intent}.`,
    });
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

    const command = commandMatch[1].toLowerCase();

    return this.hasIntent(command) ? command : null;
  }

  /**
   * Determines whether the user wants a question answered,
   * a plan created, or changes applied.
   *
   * Precedence is important:
   * 1. Explicit plan-only constraint
   * 2. Explicit no-change constraint
   * 3. Question-shaped request
   * 4. Explicit modification request
   * 5. Read-only investigation
   */
  private detectInteractionIntent(
    text: string,
  ): IntentClassification['interactionIntent'] | null {
    if (PATTERNS.PLAN_PATTERN.test(text)) {
      return 'plan';
    }

    if (PATTERNS.NO_CHANGE_PATTERN.test(text)) {
      return 'question';
    }

    if (PATTERNS.QUESTION_PATTERN.test(text)) {
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