import { TASK_ANALYZER_CONSTANTS } from "../constants";
import type {
  TaskClarity,
  TaskClarityAnalysis,
  TaskClarityAnalyzerInput,
  TaskClaritySignal,
  TaskTarget,
} from "../types";

export class TaskClarityAnalyzer {
  /**
   * Returns only the final task clarity.
   */
  public estimateClarity(input: TaskClarityAnalyzerInput): TaskClarity {
    return this.analyzeClarity(input).clarity;
  }

  /**
   * Evaluates whether the requested outcome and target are sufficiently
   * clear to proceed with task discovery or execution.
   */
  public analyzeClarity(input: TaskClarityAnalyzerInput): TaskClarityAnalysis {
    const text = input.userMessage.trim();
    const signals: TaskClaritySignal[] = [];

    if (!text) {
      return {
        clarity: "unclear",
        confidence: 1,
        signals: [
          {
            clarity: "unclear",
            confidence: 1,
            evidence: "The task description is empty.",
          },
        ],
      };
    }

    if (input.intentRequiresClarification) {
      return {
        clarity: "unclear",
        confidence: 0.98,
        signals: [
          {
            clarity: "unclear",
            confidence: 0.98,
            evidence: "Intent resolution already requires clarification.",
          },
        ],
      };
    }

    if (input.intentConfidence < 0.6) {
      signals.push({
        clarity: "unclear",
        confidence: 0.9,
        evidence: `Intent confidence is below the acceptance threshold: ${input.intentConfidence.toFixed(2)}.`,
      });
    } else if (input.intentConfidence >= 0.8) {
      signals.push({
        clarity: "clear",
        confidence: 0.8,
        evidence: `Intent confidence is strong: ${input.intentConfidence.toFixed(2)}.`,
      });
    } else {
      signals.push({
        clarity: "partially_clear",
        confidence: 0.7,
        evidence: `Intent confidence is moderate: ${input.intentConfidence.toFixed(2)}.`,
      });
    }

    if (input.confidenceMargin < 0.15) {
      signals.push({
        clarity: "unclear",
        confidence: 0.88,
        evidence: `The intent confidence margin is small: ${input.confidenceMargin.toFixed(2)}.`,
      });
    }

    const targets = this.deduplicateTargets(input.targets);

    const hasTarget = targets.length > 0;
    const hasExplicitAction =
      TASK_ANALYZER_CONSTANTS.CLARITY_PATTERNS.EXPLICIT_ACTION_PATTERN.test(
        text,
      );

    const hasExplicitOutcome =
      TASK_ANALYZER_CONSTANTS.CLARITY_PATTERNS.EXPLICIT_OUTCOME_PATTERN.test(
        text,
      );

    const hasVagueAction =
      TASK_ANALYZER_CONSTANTS.CLARITY_PATTERNS.VAGUE_ACTION_PATTERN.test(
        text,
      );

    const hasAmbiguousReference =
      TASK_ANALYZER_CONSTANTS.CLARITY_PATTERNS.AMBIGUOUS_REFERENCE_PATTERN.test(
        text,
      );

    if (hasTarget) {
      signals.push({
        clarity: "clear",
        confidence: 0.88,
        evidence: `${targets.length} explicit or referenced task target(s) were identified.`,
      });
    }

    if (hasExplicitAction && hasExplicitOutcome) {
      signals.push({
        clarity: "clear",
        confidence: 0.9,
        evidence:
          "The request contains both an explicit action and an explicit outcome.",
      });
    } else if (hasExplicitAction) {
      signals.push({
        clarity: "partially_clear",
        confidence: 0.72,
        evidence:
          "An explicit action was found, but the requested outcome may require discovery.",
      });
    }

    if (
      TASK_ANALYZER_CONSTANTS.CLARITY_PATTERNS.CLEAR_SHORT_COMMAND_PATTERN.test(
        text,
      )
    ) {
      signals.push({
        clarity: "clear",
        confidence: 0.94,
        evidence: "The short request is an explicit and actionable command.",
      });
    }

    if (hasVagueAction && !hasExplicitOutcome) {
      signals.push({
        clarity: hasTarget ? "partially_clear" : "unclear",
        confidence: 0.86,
        evidence:
          "The request uses a vague action without describing a concrete outcome.",
      });
    }

    if (hasAmbiguousReference && !hasTarget) {
      signals.push({
        clarity: "unclear",
        confidence: 0.9,
        evidence:
          "The request contains an unresolved reference without artifact or target metadata.",
      });
    }

    if (
      TASK_ANALYZER_CONSTANTS.CLARITY_PATTERNS.EXPLICIT_CONSTRAINT_PATTERN.test(
        text,
      )
    ) {
      signals.push({
        clarity: "clear",
        confidence: 0.7,
        evidence: "The request contains an explicit constraint.",
      });
    }

    if (signals.length === 0) {
      return {
        clarity: "partially_clear",
        confidence: 0.5,
        signals: [
          {
            clarity: "partially_clear",
            confidence: 0.5,
            evidence: "No strong clarity or ambiguity evidence was detected.",
          },
        ],
      };
    }

    return this.resolveSignals(signals);
  }

  private resolveSignals(signals: TaskClaritySignal[]): TaskClarityAnalysis {
    const scores: Record<TaskClarity, number> = {
      clear: 0,
      partially_clear: 0,
      unclear: 0,
    };

    for (const signal of signals) {
      scores[signal.clarity] += signal.confidence;
    }

    /*
     * Strong uncertainty evidence should prevent positive signals from
     * silently marking a task clear.
     */
    const strongUnclearSignal = signals.some(
      (signal) => signal.clarity === "unclear" && signal.confidence >= 0.88,
    );

    if (strongUnclearSignal) {
      const strongestUnclear = Math.max(
        ...signals
          .filter((signal) => signal.clarity === "unclear")
          .map((signal) => signal.confidence),
      );

      return {
        clarity: "unclear",
        confidence: strongestUnclear,
        signals,
      };
    }

    const orderedResults = (
      Object.entries(scores) as Array<[TaskClarity, number]>
    ).sort((first, second) => second[1] - first[1]);

    const [clarity, score] = orderedResults[0];

    const relevantSignals = signals.filter(
      (signal) => signal.clarity === clarity,
    );

    const confidence =
      relevantSignals.length > 0
        ? relevantSignals.reduce((sum, signal) => sum + signal.confidence, 0) /
          relevantSignals.length
        : Math.min(1, score);

    return {
      clarity,
      confidence: Math.min(1, confidence),
      signals,
    };
  }

  private deduplicateTargets(targets: readonly TaskTarget[]): TaskTarget[] {
    const seen = new Set<string>();
    const uniqueTargets: TaskTarget[] = [];

    for (const target of targets) {
      const value = target.value.trim();

      if (!value) {
        continue;
      }

      const key = [target.kind, value.replace(/\\/g, "/").toLowerCase()].join(
        ":",
      );

      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      uniqueTargets.push(target);
    }

    return uniqueTargets;
  }
}
