import { TASK_ANALYZER_CONSTANTS } from "../constants";
import type {
  TaskComplexity,
  TaskComplexityDetails,
  TaskComplexitySignal,
} from "../types";

export class TaskComplexityAnalyzer {
  constructor() {
    const {} = TASK_ANALYZER_CONSTANTS.ANALYSIS_PATTERNS;
  }
  /**
   * Returns only the final complexity classification.
   */
  public estimateComplexityByText(text: string): TaskComplexity {
    return this.analyzeComplexityByText(text).complexity;
  }

  /**
   * Returns complexity with the score and supporting evidence.
   *
   * The score is heuristic. It represents accumulated complexity signals,
   * not an exact estimate of effort or duration.
   */
  public analyzeComplexityByText(text: string): TaskComplexityDetails {
    const normalizedText = text.trim();

    if (!normalizedText) {
      return {
        complexity: "simple",
        score: 0,
        signals: [
          {
            name: "empty_text",
            score: 0,
            evidence:
              "No task description was available for complexity analysis.",
          },
        ],
      };
    }

    const signals: TaskComplexitySignal[] = [];

    let score = 0;

    score += this.scoreDescriptionLength(normalizedText, signals);
    score += this.scoreConnectors(normalizedText, signals);
    score += this.scoreActions(normalizedText, signals);
    score += this.scoreFileReferences(normalizedText, signals);
    score += this.scoreScope(normalizedText, signals);
    score += this.scoreTechnicalFactors(normalizedText, signals);
    score += this.scoreVerification(normalizedText, signals);
    score += this.scoreSimpleTaskSignals(normalizedText, score, signals);
    const normalizedScore = Math.max(0, score);
    return {
      complexity: this.mapScoreToComplexity(normalizedScore),
      score: normalizedScore,
      signals,
    };
  }

  private scoreDescriptionLength(
    text: string,
    signals: TaskComplexitySignal[],
  ): number {
    /*
     * Message length is weak evidence. A long explanation can still
     * describe a simple task, so length contributes at most one point.
     */
    if (text.length > 500) {
      signals.push({
        name: "long_description",
        score: 1,
        evidence: `The task description contains ${text.length} characters.`,
      });

      return 1;
    }

    return 0;
  }

  private scoreConnectors(
    text: string,
    signals: TaskComplexitySignal[],
  ): number {
    const connectors = this.countMatches(
      text,
      TASK_ANALYZER_CONSTANTS.ANALYSIS_PATTERNS.CONNECTOR_PATTERN,
    );

    if (connectors >= 4) {
      signals.push({
        name: "multiple_steps",
        score: 2,
        evidence: `${connectors} sequencing or additive connectors were detected.`,
      });

      return 2;
    }

    if (connectors >= 2) {
      signals.push({
        name: "several_steps",
        score: 1,
        evidence: `${connectors} sequencing or additive connectors were detected.`,
      });

      return 1;
    }

    return 0;
  }

  private scoreActions(text: string, signals: TaskComplexitySignal[]): number {
    const actions = this.countMatches(
      text,
      TASK_ANALYZER_CONSTANTS.ANALYSIS_PATTERNS.ACTION_PATTERN,
    );

    if (actions >= 4) {
      signals.push({
        name: "many_actions",
        score: 3,
        evidence: `${actions} action verbs were detected.`,
      });

      return 3;
    }

    if (actions >= 2) {
      signals.push({
        name: "multiple_actions",
        score: 2,
        evidence: `${actions} action verbs were detected.`,
      });

      return 2;
    }

    if (actions === 1) {
      signals.push({
        name: "single_action",
        score: 1,
        evidence: "One explicit task action was detected.",
      });

      return 1;
    }

    return 0;
  }

  private scoreFileReferences(
    text: string,
    signals: TaskComplexitySignal[],
  ): number {
    const files = this.extractUniqueFileReferences(text);

    if (files.length >= 6) {
      signals.push({
        name: "many_files",
        score: 3,
        evidence: `${files.length} distinct file references were detected.`,
      });

      return 3;
    }

    if (files.length >= 3) {
      signals.push({
        name: "multiple_files",
        score: 2,
        evidence: `${files.length} distinct file references were detected.`,
      });

      return 2;
    }

    if (files.length >= 1) {
      signals.push({
        name: "explicit_files",
        score: 1,
        evidence: `${files.length} explicit file reference was detected.`,
      });

      return 1;
    }

    return 0;
  }

  private scoreScope(text: string, signals: TaskComplexitySignal[]): number {
    let score = 0;

    if (
      TASK_ANALYZER_CONSTANTS.ANALYSIS_PATTERNS.MULTI_PACKAGE_PATTERN.test(
        text,
      )
    ) {
      score += 3;

      signals.push({
        name: "workspace_scope",
        score: 3,
        evidence:
          "The request appears to span multiple packages, projects, or services.",
      });
    } else if (
      TASK_ANALYZER_CONSTANTS.ANALYSIS_PATTERNS.BROAD_SCOPE_PATTERN.test(
        text,
      )
    ) {
      score += 2;

      signals.push({
        name: "broad_scope",
        score: 2,
        evidence: "Repository-wide or broadly scoped language was detected.",
      });
    }

    return score;
  }

  private scoreTechnicalFactors(
    text: string,
    signals: TaskComplexitySignal[],
  ): number {
    let score = 0;

    score += this.addPatternSignal({
      text,
      pattern:
        TASK_ANALYZER_CONSTANTS.ANALYSIS_PATTERNS.ARCHITECTURE_PATTERN,
      signals,
      name: "architecture",
      value: 2,
      evidence: "Architecture or infrastructure work was detected.",
    });

    score += this.addPatternSignal({
      text,
      pattern:
        TASK_ANALYZER_CONSTANTS.ANALYSIS_PATTERNS.INTEGRATION_PATTERN,
      signals,
      name: "integration",
      value: 2,
      evidence: "External integration work was detected.",
    });

    score += this.addPatternSignal({
      text,
      pattern:
        TASK_ANALYZER_CONSTANTS.ANALYSIS_PATTERNS.CONCURRENCY_PATTERN,
      signals,
      name: "concurrency",
      value: 3,
      evidence: "Concurrency or synchronization concerns were detected.",
    });

    score += this.addPatternSignal({
      text,
      pattern: TASK_ANALYZER_CONSTANTS.ANALYSIS_PATTERNS.MIGRATION_PATTERN,
      signals,
      name: "migration",
      value: 2,
      evidence: "Migration or compatibility work was detected.",
    });

    score += this.addPatternSignal({
      text,
      pattern: TASK_ANALYZER_CONSTANTS.ANALYSIS_PATTERNS.DATA_PATTERN,
      signals,
      name: "data_change",
      value: 2,
      evidence: "Database, schema, or data-transformation work was detected.",
    });

    score += this.addPatternSignal({
      text,
      pattern: TASK_ANALYZER_CONSTANTS.ANALYSIS_PATTERNS.SECURITY_PATTERN,
      signals,
      name: "security",
      value: 2,
      evidence:
        "Authentication, authorization, or security-sensitive work was detected.",
    });

    score += this.addPatternSignal({
      text,
      pattern:
        TASK_ANALYZER_CONSTANTS.ANALYSIS_PATTERNS.PERFORMANCE_PATTERN,
      signals,
      name: "performance",
      value: 2,
      evidence: "Performance-sensitive work was detected.",
    });

    return score;
  }

  private scoreVerification(
    text: string,
    signals: TaskComplexitySignal[],
  ): number {
    const verificationActivities = this.countMatches(
      text,
      TASK_ANALYZER_CONSTANTS.ANALYSIS_PATTERNS.VERIFICATION_PATTERN,
    );

    if (verificationActivities >= 3) {
      signals.push({
        name: "multiple_verification_steps",
        score: 2,
        evidence: `${verificationActivities} verification activities were detected.`,
      });

      return 2;
    }

    if (verificationActivities >= 1) {
      signals.push({
        name: "verification",
        score: 1,
        evidence: "The request includes explicit verification work.",
      });

      return 1;
    }

    return 0;
  }

  private scoreSimpleTaskSignals(
    text: string,
    currentScore: number,
    signals: TaskComplexitySignal[],
  ): number {
    /*
     * Only reduce the score when no strong complexity evidence exists.
     * A repository-wide formatting task should not become simple merely
     * because it contains the word "format".
     */
    if (
      currentScore <= 3 &&
      TASK_ANALYZER_CONSTANTS.ANALYSIS_PATTERNS.SIMPLE_TASK_PATTERN.test(
        text,
      )
    ) {
      signals.push({
        name: "localized_simple_change",
        score: -1,
        evidence:
          "Language associated with a localized mechanical change was detected.",
      });

      return -1;
    }

    return 0;
  }

  private addPatternSignal({
    text,
    pattern,
    signals,
    name,
    value,
    evidence,
  }: {
    text: string;
    pattern: RegExp;
    signals: TaskComplexitySignal[];
    name: string;
    value: number;
    evidence: string;
  }): number {
    if (!pattern.test(text)) {
      return 0;
    }

    signals.push({
      name,
      score: value,
      evidence,
    });

    return value;
  }

  private countMatches(text: string, pattern: RegExp): number {
    return text.match(pattern)?.length ?? 0;
  }

  private extractUniqueFileReferences(text: string): string[] {
    const files = new Set<string>();

    for (const match of text.matchAll(
      TASK_ANALYZER_CONSTANTS.ANALYSIS_PATTERNS.FILE_REFERENCE_PATTERN,
    )) {
      const file = match[1]?.trim().replace(/\\/g, "/");

      if (file) {
        files.add(file);
      }
    }

    return [...files];
  }

  private mapScoreToComplexity(score: number): TaskComplexity {
    if (score >= 10) {
      return "very_complex";
    }

    if (score >= 6) {
      return "complex";
    }

    if (score >= 3) {
      return "moderate";
    }

    return "simple";
  }
}
