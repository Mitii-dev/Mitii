import { TASK_ANALYZER_CONSTANTS } from "../constants";
import type {
  TaskConstraint,
  TaskRisk,
  TaskRiskAnalysis,
  TaskRiskAnalyzerInput,
  TaskRiskSignal,
  TaskScope,
} from "../types";

interface RiskPatternDefinition {
  pattern: RegExp;
  score: number;
  risk: TaskRisk;
  evidence: string;

  /**
   * When true, this risk applies only when the user wants changes made.
   */
  requiresAct?: boolean;
}

export class TaskRiskAnalyzer {
  public analyze(input: TaskRiskAnalyzerInput): TaskRiskAnalysis {
    const signals: TaskRiskSignal[] = [];
    const isMutationRequest = input.interactionIntent === "act";

    let score = 0;

    score += this.evaluatePatterns(
      input.userMessage,
      isMutationRequest,
      signals,
    );

    score += this.evaluateScope(input.scope, isMutationRequest, signals);

    score += this.evaluateIntent(
      input.primaryTaskIntent,
      isMutationRequest,
      signals,
    );

    score += this.evaluateConstraints(input.constraints ?? [], signals);

    /*
     * Read-only requests can still involve sensitive areas, but their
     * execution risk is lower because no project state is being changed.
     */
    if (!isMutationRequest && score > 0) {
      const reduction = Math.min(3, Math.floor(score * 0.35));

      if (reduction > 0) {
        score -= reduction;

        signals.push({
          name: "read_only_interaction",
          score: -reduction,
          evidence: "The interaction is read-only, reducing execution risk.",
        });
      }
    }

    score = Math.max(0, score);

    return {
      risk: this.scoreToRisk(score),
      score,
      confidence: this.calculateConfidence(signals),
      signals,
    };
  }

  private evaluatePatterns(
    text: string,
    isMutationRequest: boolean,
    signals: TaskRiskSignal[],
  ): number {
    let score = 0;

    const definitions: readonly RiskPatternDefinition[] =
      TASK_ANALYZER_CONSTANTS.RISK_PATTERNS.DEFINITIONS;

    for (let index = 0; index < definitions.length; index += 1) {
      const definition = definitions[index];

      /*
       * Skip execution-specific risks for question and plan requests.
       *
       * Example:
       * "Explain what rm -rf does" should not be treated as though
       * the user asked the agent to execute it.
       */
      if (definition.requiresAct && !isMutationRequest) {
        continue;
      }

      if (!this.matches(definition.pattern, text)) {
        continue;
      }

      const signalName = this.createPatternSignalName(definition, index);

      score += definition.score;

      signals.push({
        name: signalName,
        score: definition.score,
        evidence: definition.evidence,
      });
    }

    return score;
  }

  private evaluateScope(
    scope: TaskScope,
    isMutationRequest: boolean,
    signals: TaskRiskSignal[],
  ): number {
    if (!isMutationRequest) {
      return 0;
    }

    switch (scope) {
      case "workspace": {
        signals.push({
          name: "workspace_scope",
          score: 3,
          evidence:
            "The requested change may affect the entire workspace or monorepo.",
        });

        return 3;
      }

      case "repository": {
        signals.push({
          name: "repository_scope",
          score: 2,
          evidence: "The requested change may affect the entire repository.",
        });

        return 2;
      }

      case "package":
      case "multi_file": {
        signals.push({
          name: "multi_location_scope",
          score: 1,
          evidence:
            "The requested change affects multiple files or a complete package.",
        });

        return 1;
      }

      case "single_location":
      case "unknown":
      default:
        return 0;
    }
  }

  private evaluateIntent(
    primaryTaskIntent: TaskRiskAnalyzerInput["primaryTaskIntent"],
    isMutationRequest: boolean,
    signals: TaskRiskSignal[],
  ): number {
    if (!isMutationRequest) {
      return 0;
    }

    const highRiskIntents = new Set<string>([
      "security",
      "migrate",
      "schema",
      "dependency",
      "config",
    ]);

    const mediumRiskIntents = new Set<string>([
      "feature",
      "refactor",
      "optimize",
      "scaffold",
    ]);

    if (highRiskIntents.has(primaryTaskIntent)) {
      signals.push({
        name: "high_risk_task_intent",
        score: 2,
        evidence:
          `${primaryTaskIntent} tasks commonly affect sensitive ` +
          "or shared system behavior.",
      });

      return 2;
    }

    if (mediumRiskIntents.has(primaryTaskIntent)) {
      signals.push({
        name: "change_task_intent",
        score: 1,
        evidence:
          `${primaryTaskIntent} may require changes to existing ` +
          "system behavior.",
      });

      return 1;
    }

    return 0;
  }

  private evaluateConstraints(
    constraints: readonly TaskConstraint[],
    signals: TaskRiskSignal[],
  ): number {
    if (constraints.length === 0) {
      return 0;
    }

    const safeConstraintPattern =
      TASK_ANALYZER_CONSTANTS.RISK_PATTERNS.SAFE_CONSTRAINT_PATTERN;

    const hasSafetyConstraint = constraints.some((constraint) =>
      this.matches(
        safeConstraintPattern,
        `${constraint.sourceText} ${constraint.value}`,
      ),
    );

    if (!hasSafetyConstraint) {
      return 0;
    }

    signals.push({
      name: "explicit_safety_constraint",
      score: -1,
      evidence:
        "The user supplied an explicit constraint limiting risky changes.",
    });

    return -1;
  }

  private scoreToRisk(score: number): TaskRisk {
    if (score >= 10) {
      return "critical";
    }

    if (score >= 6) {
      return "high";
    }

    if (score >= 3) {
      return "medium";
    }

    return "low";
  }

  private calculateConfidence(signals: readonly TaskRiskSignal[]): number {
    if (signals.length === 0) {
      return 0.65;
    }

    const positiveSignalCount = signals.filter(
      (signal) => signal.score > 0,
    ).length;

    const negativeSignalCount = signals.filter(
      (signal) => signal.score < 0,
    ).length;

    const evidenceStrength = Math.min(0.25, positiveSignalCount * 0.05);

    const conflictPenalty = Math.min(0.1, negativeSignalCount * 0.03);

    return this.clamp(0.7 + evidenceStrength - conflictPenalty);
  }

  /**
   * Creates a stable signal name because the risk catalog currently
   * provides risk/evidence but does not provide an explicit name.
   */
  private createPatternSignalName(
    definition: RiskPatternDefinition,
    index: number,
  ): string {
    const evidenceName = definition.evidence
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 48);

    return evidenceName
      ? `${definition.risk}_${evidenceName}`
      : `${definition.risk}_risk_pattern_${index + 1}`;
  }

  /**
   * Resets lastIndex so global or sticky catalog regexes behave
   * consistently across repeated analyzer calls.
   */
  private matches(pattern: RegExp, text: string): boolean {
    pattern.lastIndex = 0;

    const matched = pattern.test(text);

    pattern.lastIndex = 0;

    return matched;
  }

  private clamp(value: number): number {
    return Math.max(0, Math.min(1, value));
  }
}
