import { TASK_ANALYZER_CONSTANTS } from "../constants";
import type {
  TaskAnalysisSignal,
  TaskConstraint,
  TaskConstraintExtraction,
  TaskConstraintKind,
} from "../types";

interface ConstraintPatternDefinition {
  kind: TaskConstraintKind;
  pattern: RegExp;
  confidence: number;
}

export class TaskConstraintExtractor {
  public extract(userMessage: string): TaskConstraintExtraction {
    const constraints: TaskConstraint[] = [];

    const definitions: readonly ConstraintPatternDefinition[] = [
      ...TASK_ANALYZER_CONSTANTS.CONSTRAINT_PATTERNS.GENERAL,
      ...TASK_ANALYZER_CONSTANTS.CONSTRAINT_PATTERNS.SCOPE,
      ...TASK_ANALYZER_CONSTANTS.CONSTRAINT_PATTERNS.VERIFICATION,
    ];

    for (const definition of definitions) {
      this.collectMatches(userMessage, definition, constraints);
    }

    const deduplicated = this.deduplicate(constraints);
    const signals = this.buildSignals(deduplicated);

    return {
      values: deduplicated.map((constraint) => constraint.value),
      constraints: deduplicated,
      signals,
      confidence: this.calculateConfidence(deduplicated),
    };
  }

  public extractValues(userMessage: string): string[] {
    return this.extract(userMessage).constraints.map(
      (constraint) => constraint.value,
    );
  }

  private collectMatches(
    text: string,
    definition: ConstraintPatternDefinition,
    constraints: TaskConstraint[],
  ): void {
    const pattern = this.cloneGlobalPattern(definition.pattern);

    for (const match of text.matchAll(pattern)) {
      const matchedText = match[0]?.trim();
      const capturedValue = match[1]?.trim();
      const value = this.cleanConstraint(capturedValue || matchedText);

      if (!value) {
        continue;
      }

      constraints.push({
        kind: definition.kind,
        value,
        sourceText: matchedText,
        confidence: definition.confidence,
      });
    }
  }

  private deduplicate(
    constraints: readonly TaskConstraint[],
  ): TaskConstraint[] {
    const selected = new Map<string, TaskConstraint>();

    for (const constraint of constraints) {
      const normalized = this.normalize(constraint.value);
      const key = `${constraint.kind}:${normalized}`;

      const existing = selected.get(key);

      if (!existing || constraint.confidence > existing.confidence) {
        selected.set(key, constraint);
      }
    }

    const values = [...selected.values()];

    return values.filter((candidate, index) => {
      const candidateValue = this.normalize(candidate.value);

      return !values.some((other, otherIndex) => {
        if (index === otherIndex || candidate.kind !== other.kind) {
          return false;
        }

        const otherValue = this.normalize(other.value);

        return (
          otherValue.length > candidateValue.length &&
          otherValue.includes(candidateValue) &&
          other.confidence >= candidate.confidence
        );
      });
    });
  }

  private buildSignals(
    constraints: readonly TaskConstraint[],
  ): TaskAnalysisSignal[] {
    return constraints.map((constraint) => ({
      type: "constraint",
      value: `${constraint.kind}:${constraint.value}`,
      weight: constraint.confidence,
      evidence: `Detected ${constraint.kind} constraint: ${constraint.sourceText}`,
    }));
  }

  private calculateConfidence(constraints: readonly TaskConstraint[]): number {
    if (constraints.length === 0) {
      return 0.5;
    }

    const average =
      constraints.reduce((sum, constraint) => sum + constraint.confidence, 0) /
      constraints.length;

    return this.clamp(average);
  }

  private cleanConstraint(value: string): string {
    return value
      .replace(/\s+/g, " ")
      .replace(/^[,;:\s]+/, "")
      .replace(/[,;:\s]+$/, "")
      .trim();
  }

  private normalize(value: string): string {
    return value
      .toLowerCase()
      .replace(/\s+/g, " ")
      .replace(/[.,;:!?]+$/, "")
      .trim();
  }

  private cloneGlobalPattern(pattern: RegExp): RegExp {
    const flags = pattern.flags.includes("g")
      ? pattern.flags
      : `${pattern.flags}g`;

    return new RegExp(pattern.source, flags);
  }

  private clamp(value: number): number {
    return Math.max(0, Math.min(1, value));
  }
}
