import { TASK_ANALYZER_CONSTANTS } from "../constants";
import type {
  OutcomeCandidate,
  TaskAnalysisSignal,
  TaskOutcome,
  TaskOutcomeExtraction,
} from "../types";

export class TaskOutcomeExtractor {
  public extract(userMessage: string): TaskOutcomeExtraction {
    const text = userMessage.trim();

    if (
      !text ||
      TASK_ANALYZER_CONSTANTS.OUTCOME_PATTERNS.ACKNOWLEDGEMENT_PATTERN.test(
        text,
      )
    ) {
      return {
        outcomes: [],
        values: [],
        signals: [],
        confidence: 0.5,
      };
    }

    const candidates = this.extractCandidates(text);
    const outcomes = this.normalizeCandidates(candidates);
    const deduplicated = this.deduplicate(outcomes);

    return {
      outcomes: deduplicated,
      values: deduplicated.map((outcome) => outcome.value),
      signals: this.buildSignals(deduplicated),
      confidence: this.calculateConfidence(deduplicated),
    };
  }

  private extractCandidates(text: string): OutcomeCandidate[] {
    const candidates: OutcomeCandidate[] = [];

    const sentences = text
      .split(TASK_ANALYZER_CONSTANTS.OUTCOME_PATTERNS.SENTENCE_BOUNDARY_PATTERN)
      .map((sentence) => sentence.trim())
      .filter(Boolean);

    for (const sentence of sentences) {
      const clauses = sentence
        .split(
          TASK_ANALYZER_CONSTANTS.OUTCOME_PATTERNS.OUTCOME_CONNECTOR_PATTERN,
        )
        .map((clause) => clause.trim())
        .filter(Boolean);

      for (const clause of clauses) {
        const candidate = this.createCandidate(clause);

        if (candidate) {
          candidates.push(candidate);
        }
      }
    }

    return candidates;
  }

  private createCandidate(sourceText: string): OutcomeCandidate | null {
    const cleanedSource = sourceText
      .replace(
        TASK_ANALYZER_CONSTANTS.OUTCOME_PATTERNS.LEADING_CONNECTOR_PATTERN,
        "",
      )
      .replace(
        TASK_ANALYZER_CONSTANTS.OUTCOME_PATTERNS.TRAILING_CONNECTOR_PATTERN,
        "",
      )
      .trim();

    if (!cleanedSource) {
      return null;
    }

    /*
     * A prohibited action is a constraint, not a requested outcome.
     *
     * Example:
     * "Do not fix it."
     */
    if (
      TASK_ANALYZER_CONSTANTS.OUTCOME_PATTERNS.NEGATED_ACTION_PATTERN.test(
        cleanedSource,
      )
    ) {
      return null;
    }

    const normalizedPrefix = cleanedSource.replace(
      TASK_ANALYZER_CONSTANTS.OUTCOME_PATTERNS.POLITE_PREFIX_PATTERN,
      "",
    );

    const actionMatch = normalizedPrefix.match(
      TASK_ANALYZER_CONSTANTS.OUTCOME_PATTERNS.ACTION_AT_START_PATTERN,
    );

    if (actionMatch) {
      return {
        sourceText: cleanedSource,
        action: actionMatch[1].toLowerCase(),
        confidence: 0.92,
      };
    }

    /*
     * Allows slightly indirect but still explicit commands.
     *
     * Example:
     * "The next step is to update the schema"
     */
    const generalActionMatch = normalizedPrefix.match(
      TASK_ANALYZER_CONSTANTS.OUTCOME_PATTERNS.ACTION_PATTERN,
    );

    if (generalActionMatch) {
      const beforeAction = normalizedPrefix
        .slice(0, generalActionMatch.index ?? 0)
        .trim();

      const looksLikeDirectQuestion =
        TASK_ANALYZER_CONSTANTS.OUTCOME_PATTERNS.QUESTION_PREFIX_PATTERN.test(
          beforeAction,
        );

      return {
        sourceText: cleanedSource,
        action: generalActionMatch[0].toLowerCase(),
        confidence: looksLikeDirectQuestion ? 0.78 : 0.82,
      };
    }

    return null;
  }

  private normalizeCandidates(
    candidates: readonly OutcomeCandidate[],
  ): TaskOutcome[] {
    return candidates
      .map((candidate): TaskOutcome | null => {
        const value = this.normalizeOutcomeValue(candidate.sourceText);

        if (!value) {
          return null;
        }

        return {
          value,
          sourceText: candidate.sourceText,
          action: candidate.action,
          confidence: candidate.confidence,
        };
      })
      .filter((outcome): outcome is TaskOutcome => outcome !== null);
  }

  private normalizeOutcomeValue(sourceText: string): string {
    const value = sourceText
      .replace(
        TASK_ANALYZER_CONSTANTS.OUTCOME_PATTERNS.POLITE_PREFIX_PATTERN,
        "",
      )
      .replace(
        TASK_ANALYZER_CONSTANTS.OUTCOME_PATTERNS.LEADING_CONNECTOR_PATTERN,
        "",
      )
      .replace(/\s+/g, " ")
      .replace(/^[,;:\s]+/, "")
      .replace(/[,;:\s]+$/, "")
      .trim();

    if (!value) {
      return "";
    }

    return value.charAt(0).toUpperCase() + value.slice(1);
  }

  private deduplicate(outcomes: readonly TaskOutcome[]): TaskOutcome[] {
    const selected = new Map<string, TaskOutcome>();

    for (const outcome of outcomes) {
      const key = this.normalizeForComparison(outcome.value);

      const existing = selected.get(key);

      if (!existing || outcome.confidence > existing.confidence) {
        selected.set(key, outcome);
      }
    }

    return [...selected.values()];
  }

  private buildSignals(outcomes: readonly TaskOutcome[]): TaskAnalysisSignal[] {
    return outcomes.map(
      (outcome): TaskAnalysisSignal => ({
        type: "clarity",
        value: outcome.value,
        weight: this.clamp(outcome.confidence),
        evidence:
          `Explicit requested outcome detected: ` + `"${outcome.sourceText}"`,
      }),
    );
  }

  private calculateConfidence(outcomes: readonly TaskOutcome[]): number {
    if (outcomes.length === 0) {
      /*
       * No extracted outcome does not necessarily mean failure.
       * The message may be an acknowledgement or incomplete request.
       */
      return 0.5;
    }

    const totalConfidence = outcomes.reduce(
      (sum, outcome) => sum + outcome.confidence,
      0,
    );

    return this.clamp(totalConfidence / outcomes.length);
  }

  private normalizeForComparison(value: string): string {
    return value
      .toLowerCase()
      .replace(/\s+/g, " ")
      .replace(/[.,;:!?]+$/, "")
      .trim();
  }

  private clamp(value: number): number {
    return Math.max(0, Math.min(1, value));
  }
}
